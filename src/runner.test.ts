import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { isArtifactTooLarge, isForwardStage, runnerRoutes } from "./runner";
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

  async run() {
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
      return { meta: { changes: exhausted ? 1 : 0 } };
    }
    throw new Error(`unexpected D1 run: ${this.query}`);
  }

  async first<T>() {
    if (this.query.startsWith("UPDATE generation_jobs") && this.query.includes("RETURNING id,user_id")) {
      const [capacityStartedAt, leaseToken, leaseExpiresAt, _updatedAt, maxAttempts, expiredAt, capacityWindowStart, globalLimit] = this.args as [number, string, number, number, number, number, number, number];
      const job = this.db.job;
      const reclaimable = ["queued", "retryable_failed"].includes(job.status)
        || (["collecting", "writing", "illustrating", "validating"].includes(job.status) && (job.lease_expires_at ?? 0) < expiredAt);
      const startedCount = job.capacity_started_at !== null && job.capacity_started_at >= capacityWindowStart ? 1 : 0;
      if (job.attempt >= maxAttempts || !reclaimable || (job.capacity_started_at === null && startedCount >= globalLimit)) return null;
      job.status = "collecting";
      job.attempt += 1;
      job.capacity_started_at ??= capacityStartedAt;
      job.lease_token = leaseToken;
      job.lease_expires_at = leaseExpiresAt;
      return { ...job } as T;
    }
    if (this.query.startsWith("SELECT username FROM users")) return { username: "octocat" } as T;
    if (this.query.includes("SELECT j.*,u.username FROM generation_jobs")) {
      const [id, leaseToken] = this.args as [string, string];
      const job = this.db.job;
      const held = job.id === id
        && job.lease_token === leaseToken
        && (job.lease_expires_at ?? 0) >= Math.floor(Date.now() / 1000)
        && ["collecting", "writing", "illustrating", "validating"].includes(job.status);
      return (held ? { ...job, username: "octocat" } : null) as T;
    }
    throw new Error(`unexpected D1 first: ${this.query}`);
  }
}

class StubD1 {
  readonly versions = new Map<string, string>();
  readonly dispatches = new Map<string, string>();

  constructor(readonly job: StubJob) {}

  prepare(query: string) {
    return new StubStatement(this, query);
  }

  async batch() {
    throw new Error("expired or superseded lease reached D1 batch");
  }
}

class StubR2 {
  async list() { return { objects: [], truncated: false }; }
  async delete() {}
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
    const claim = await runnerRequest(db, "/runner/jobs/claim", { method: "POST" });
    expect(claim.status).toBe(204);
    expect(db.job.status).toBe("permanent_failed");
    expect(LIVE_STATUSES).not.toContain(db.job.status as never);
    expect(db.job.lease_token).toBeNull();
    expect(db.job.lease_expires_at).toBeNull();
  });
});

function stubDb(overrides: Partial<StubJob>): StubD1 {
  return new StubD1({
    id: jobId,
    user_id: "1",
    week_key: "2026-W32",
    status: "queued",
    attempt: 0,
    capacity_started_at: null,
    lease_token: null,
    lease_expires_at: null,
    ...overrides,
  });
}

async function runnerRequest(db: StubD1, path: string, init: RequestInit): Promise<Response> {
  const app = new Hono().route("/runner", runnerRoutes as never);
  const headers = new Headers(init.headers);
  headers.set("authorization", "Bearer expected");
  headers.set("content-type", "application/json");
  return await app.request(path, { ...init, headers }, {
    RUNNER_SECRET: "expected",
    ROLLING_7D_GLOBAL_GENERATION_LIMIT: "100",
    DB: db,
    DISPATCHES: new StubR2(),
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
