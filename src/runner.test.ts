import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { CLAIM_JOB_SQL, isArtifactTooLarge, isForwardStage, isWebpContentType, runnerRoutes } from "./runner";
import { LIVE_STATUSES } from "./queue";

const jobId = "2bb65583-b570-4a55-b4e4-5de336b10664";
const oldLease = "5ba2cbaf-5dc5-4a3a-8be0-d4230dd11e09";

type StubJob = {
  id: string;
  user_id: string;
  week_key: string;
  status: string;
  attempt: number;
  capacity_started_at: number | null;
  created_at: number;
  lease_token: string | null;
  lease_expires_at: number | null;
};

class StubStatement {
  args: unknown[] = [];

  constructor(private readonly db: StubD1, readonly query: string) {}

  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }

  async all<T>() {
    if (this.query.includes("last_error='generation attempts exhausted'")) {
      const [now, maxAttempts] = this.args as number[];
      const job = this.db.job;
      const exhausted = job.attempt >= maxAttempts
        && ["collecting", "writing", "illustrating", "validating"].includes(job.status)
        && (job.lease_expires_at ?? 0) < now;
      if (exhausted) {
        job.status = "permanent_failed";
        job.lease_token = null;
        job.lease_expires_at = null;
      }
      return { results: exhausted ? [{ id: job.id }] : [] } as D1Result<T>;
    }
    throw new Error(`unexpected D1 all: ${this.query}`);
  }

  async first<T>() {
    if (this.query.startsWith("UPDATE generation_jobs") && this.query.includes("RETURNING id,user_id")) {
      const [capacityStartedAt, leaseToken, leaseExpiresAt, _updatedAt, maxAttempts, expiredAt, queueCutoff, capacityWindowStart, globalLimit] = this.args as [number, string, number, number, number, number, number, number, number];
      const job = this.db.job;
      const reclaimable = ["queued", "retryable_failed"].includes(job.status)
        || (["collecting", "writing", "illustrating", "validating"].includes(job.status) && (job.lease_expires_at ?? 0) < expiredAt);
      const startedCount = job.capacity_started_at !== null && job.capacity_started_at >= capacityWindowStart ? 1 : 0;
      if (job.attempt >= maxAttempts || !reclaimable || job.created_at < queueCutoff
        || (job.capacity_started_at === null && startedCount >= globalLimit)) return null;
      job.status = "collecting";
      job.attempt += 1;
      job.capacity_started_at ??= capacityStartedAt;
      job.lease_token = leaseToken;
      job.lease_expires_at = leaseExpiresAt;
      return { ...job } as T;
    }
    if (this.query.includes("FROM users WHERE id=?")) {
      return { username: this.db.username, suppressed: this.db.runtimeSuppressed ? 1 : 0 } as T;
    }
    if (this.query.includes("FROM generation_jobs j JOIN users u")) {
      const [id, leaseToken] = this.args as [string, string];
      const job = this.db.job;
      const held = job.id === id
        && job.lease_token === leaseToken
        && (job.lease_expires_at ?? 0) >= Math.floor(Date.now() / 1000)
        && ["collecting", "writing", "illustrating", "validating"].includes(job.status);
      return (held ? { ...job, username: this.db.username, suppressed: this.db.runtimeSuppressed ? 1 : 0 } : null) as T;
    }
    throw new Error(`unexpected D1 first: ${this.query}`);
  }

  async run() {
    if (this.query.includes("last_error='profile unavailable'")) {
      const [id, leaseToken] = this.args as [string, string];
      if (this.db.job.id !== id || this.db.job.lease_token !== leaseToken) return { meta: { changes: 0 } };
      this.db.job.status = "permanent_failed";
      this.db.job.capacity_started_at = null;
      this.db.job.lease_token = null;
      this.db.job.lease_expires_at = null;
      return { meta: { changes: 1 } };
    }
    throw new Error(`unexpected D1 run: ${this.query}`);
  }
}

class StubD1 {
  readonly versions = new Map<string, string>();
  readonly dispatches = new Map<string, string>();

  constructor(readonly job: StubJob, readonly username = "octocat", readonly runtimeSuppressed = false) {}

  prepare(query: string) {
    return new StubStatement(this, query);
  }

  async batch() {
    throw new Error("expired or superseded lease reached D1 batch");
  }
}

class StubR2 {
  readonly objects: Set<string>;

  constructor(keys: string[] = []) {
    this.objects = new Set(keys);
  }

  async list({ prefix }: { prefix: string }) {
    return {
      objects: [...this.objects].filter((key) => key.startsWith(prefix)).map((key) => ({ key })),
      truncated: false,
    };
  }

  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
  }
}

describe("runner route boundary", () => {
  test("rejects missing and incorrect bearer credentials before database access", async () => {
    const app = new Hono().route("/runner", runnerRoutes as never);
    const env = { RUNNER_SECRET: "expected" } as never;
    expect((await app.request("/runner/jobs/claim", { method: "POST" }, env)).status).toBe(401);
    expect((await app.request("/runner/jobs/claim", { method: "POST", headers: { authorization: "Bearer wrong" } }, env)).status).toBe(401);
    expect((await app.request("/runner/jobs/claim", { method: "POST", headers: { authorization: "Bearer anything" } }, {} as never)).status).toBe(401);
    expect((await app.request("/runner/jobs/claim", { method: "POST", headers: { authorization: "Bearer anything" } }, { RUNNER_SECRET: "" } as never)).status).toBe(401);
  });

  test("allows only the explicit forward stage graph", () => {
    expect(isForwardStage("collecting", "writing")).toBe(true);
    expect(isForwardStage("writing", "illustrating")).toBe(true);
    expect(isForwardStage("illustrating", "validating")).toBe(true);
    for (const transition of [["writing", "collecting"], ["collecting", "validating"], ["validating", "validating"], ["validating", "published"]]) {
      expect(isForwardStage(transition[0], transition[1])).toBe(false);
    }
  });

  test("enforces the artifact byte boundary exactly", () => {
    expect(isArtifactTooLarge(5 * 1024 * 1024)).toBe(false);
    expect(isArtifactTooLarge(5 * 1024 * 1024 + 1)).toBe(true);
  });

  test("normalizes the WebP media type without accepting another format", () => {
    expect(isWebpContentType("image/webp")).toBe(true);
    expect(isWebpContentType(" IMAGE/WEBP ; charset=binary")).toBe(true);
    expect(isWebpContentType("image/png")).toBe(false);
    expect(isWebpContentType(undefined)).toBe(false);
  });

  test("executes the production claim SQL with global capacity and reclaim semantics", async () => {
    const db = await generationDatabase();
    try {
      const now = Math.floor(Date.now() / 1000);
      db.query("INSERT INTO users(id,username) VALUES ('1','started'),('2','candidate')").run();
      db.query("INSERT INTO generation_jobs(id,user_id,requested_by,week_key,status,capacity_started_at) VALUES (?,?,?,?,?,?)")
        .run("started", "1", "1", "2026-W30", "published", now);
      db.query("INSERT INTO generation_jobs(id,user_id,requested_by,week_key,status) VALUES (?,?,?,?,?)")
        .run("candidate", "2", "2", "2026-W31", "queued");

      const claim = db.query(CLAIM_JOB_SQL);
      expect(claim.get(now, "lease-1", now + 600, now, 5, now, now - 21_600, now - 604_800, 1)).toBeNull();

      db.query("UPDATE generation_jobs SET capacity_started_at=?,created_at=? WHERE id='candidate'").run(now - 10, now - 21_601);
      expect(claim.get(now, "lease-2", now + 600, now, 5, now, now - 21_600, now - 604_800, 1)).toBeNull();

      db.query("UPDATE generation_jobs SET created_at=? WHERE id='candidate'").run(now);
      const reclaimed = claim.get(now, "lease-3", now + 600, now, 5, now, now - 21_600, now - 604_800, 1) as { id: string; attempt: number };
      expect(reclaimed.id).toBe("candidate");
      expect(reclaimed.attempt).toBe(1);
    } finally {
      db.close();
    }
  });

  test("rejects publish with an expired lease", async () => {
    const db = stubDb({ status: "validating", attempt: 1, lease_token: oldLease, lease_expires_at: Math.floor(Date.now() / 1000) - 1 });
    const response = await runnerRequest(db, `/runner/jobs/${jobId}/publish`, {
      method: "POST",
      body: JSON.stringify({ leaseToken: oldLease, manifest: quietManifest(), usage: quietUsage() }),
    });
    expect(response.status).toBe(409);
    expect(db.versions.size).toBe(0);
    expect(db.dispatches.size).toBe(0);
  });

  test("rejects a superseded lease after reclaim without overwriting the newer edition", async () => {
    const db = stubDb({ status: "validating", attempt: 1, capacity_started_at: 1, lease_token: oldLease, lease_expires_at: Math.floor(Date.now() / 1000) - 1 });
    db.dispatches.set("octocat/2026-W32", "editions/octocat/2026-W32/newer.html");

    const claim = await runnerRequest(db, "/runner/jobs/claim", { method: "POST" });
    expect(claim.status).toBe(200);
    const newLease = (await claim.json() as any).job.leaseToken as string;
    expect(newLease).not.toBe(oldLease);

    db.job.status = "validating";
    const stalePublish = await runnerRequest(db, `/runner/jobs/${jobId}/publish`, {
      method: "POST",
      body: JSON.stringify({ leaseToken: oldLease, manifest: quietManifest(), usage: quietUsage() }),
    });
    expect(stalePublish.status).toBe(409);
    expect(db.dispatches.get("octocat/2026-W32")).toBe("editions/octocat/2026-W32/newer.html");
    expect(db.versions.size).toBe(0);
  });

  test("moves an attempt-exhausted expired lease to a terminal non-live state", async () => {
    const db = stubDb({ status: "validating", attempt: 5, lease_token: oldLease, lease_expires_at: Math.floor(Date.now() / 1000) - 1 });
    const r2 = new StubR2([
      `staging/${jobId}/${oldLease}/image-1.webp`,
      `staging/${jobId}/superseded-lease/image-2.webp`,
    ]);
    const claim = await runnerRequest(db, "/runner/jobs/claim", { method: "POST" }, r2);
    expect(claim.status).toBe(204);
    expect(db.job.status).toBe("permanent_failed");
    expect(LIVE_STATUSES).not.toContain(db.job.status as never);
    expect(db.job.lease_token).toBeNull();
    expect(db.job.lease_expires_at).toBeNull();
    expect(r2.objects.size).toBe(0);
  });

  test("terminalizes queued work for a profile removed from the managed schedule", async () => {
    const db = stubDb({ status: "queued" }, "gitzette-opt-out-test");
    const r2 = new StubR2([`staging/${jobId}/abandoned/image-1.webp`]);
    const claim = await runnerRequest(db, "/runner/jobs/claim", { method: "POST" }, r2);
    expect(claim.status).toBe(204);
    expect(db.job.status).toBe("permanent_failed");
    expect(db.job.capacity_started_at).toBeNull();
    expect(db.job.lease_token).toBeNull();
    expect(db.job.lease_expires_at).toBeNull();
    expect(r2.objects.size).toBe(0);
  });

  test("terminalizes queued work after a runtime takedown", async () => {
    const db = stubDb({ status: "queued" }, "octocat", true);
    const claim = await runnerRequest(db, "/runner/jobs/claim", { method: "POST" });
    expect(claim.status).toBe(204);
    expect(db.job.status).toBe("permanent_failed");
    expect(db.job.capacity_started_at).toBeNull();
  });

  test("terminalizes a runtime-suppressed profile that becomes unavailable mid-flight", async () => {
    const db = stubDb({
      status: "validating",
      attempt: 1,
      capacity_started_at: Math.floor(Date.now() / 1000),
      lease_token: oldLease,
      lease_expires_at: Math.floor(Date.now() / 1000) + 600,
    }, "octocat", true);
    const r2 = new StubR2([`staging/${jobId}/${oldLease}/image-1.webp`]);
    const response = await runnerRequest(db, `/runner/jobs/${jobId}/publish`, {
      method: "POST",
      body: JSON.stringify({ leaseToken: oldLease, manifest: quietManifest(), usage: quietUsage() }),
    }, r2);
    expect(response.status).toBe(410);
    expect(db.job.status).toBe("permanent_failed");
    expect(db.job.capacity_started_at).toBeNull();
    expect(db.job.lease_token).toBeNull();
    expect(db.job.lease_expires_at).toBeNull();
    expect(r2.objects.size).toBe(0);
    expect(db.versions.size).toBe(0);
  });
});

function stubDb(overrides: Partial<StubJob>, username = "octocat", runtimeSuppressed = false): StubD1 {
  return new StubD1({
    id: jobId,
    user_id: "1",
    week_key: "2026-W32",
    status: "queued",
    attempt: 0,
    capacity_started_at: null,
    created_at: Math.floor(Date.now() / 1000),
    lease_token: null,
    lease_expires_at: null,
    ...overrides,
  }, username, runtimeSuppressed);
}

async function runnerRequest(db: StubD1, path: string, init: RequestInit, dispatches = new StubR2()): Promise<Response> {
  const app = new Hono().route("/runner", runnerRoutes as never);
  const headers = new Headers(init.headers);
  headers.set("authorization", "Bearer expected");
  headers.set("content-type", "application/json");
  return await app.request(path, { ...init, headers }, {
    RUNNER_SECRET: "expected",
    ROLLING_7D_GLOBAL_GENERATION_LIMIT: "100",
    DB: db,
    DISPATCHES: dispatches,
  } as never);
}

function quietManifest() {
  return {
    generatorVersion: "test",
    model: "deterministic",
    promptVersion: "test",
    evidence: { state: "quiet", username: "octocat", weekKey: "2026-W32", items: [] },
    edition: { headline: "discarded", tagline: "discarded", closingNote: "discarded", stories: [] },
    images: [],
  };
}

function quietUsage() {
  return { inputTokens: 0, outputTokens: 0, tokenSource: "none", imageCount: 0, wallTimeMs: 10 };
}

async function generationDatabase(): Promise<Database> {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(await Bun.file("migrations/0000_base.sql").text());
  db.exec(await Bun.file("migrations/0001_generation_queue.sql").text());
  return db;
}
