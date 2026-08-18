import { describe, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { WEEKLY_PROFILE_USERNAMES } from "./highlighted";
import { queueRoutes } from "./queue";
import { runnerRoutes } from "./runner";
import {
  enqueueWeeklyProfiles,
  JOB_EXPIRY_CRON,
  runWeeklySchedule,
  WEEKLY_GENERATION_CRON,
  WEEKLY_GENERATION_CRONS,
  WEEKLY_GENERATION_RETRY_CRON,
} from "./schedule";
import { AOE_LAG_MS } from "./week";

type Profile = { id: string; username: string };

class StubStatement {
  args: unknown[] = [];

  constructor(
    private readonly db: StubD1,
    readonly query: string,
  ) {}

  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }

  async first<T>() {
    if (!this.query.startsWith("SELECT id FROM users")) throw new Error(`unexpected first: ${this.query}`);
    return (this.db.adminExists ? { id: "2" } : null) as T;
  }

  async all<T>() {
    if (this.query.startsWith("UPDATE generation_jobs")) {
      this.db.staleSweepCalls += 1;
      return { results: this.db.expiredJobIds.map((id) => ({ id })) } as unknown as D1Result<T>;
    }
    if (!this.query.startsWith("SELECT id,username")) throw new Error(`unexpected all: ${this.query}`);
    return { results: this.db.profiles } as D1Result<T>;
  }
}

class StubD1 {
  readonly scheduleKeys = new Set<string>();
  batchCalls = 0;
  staleSweepCalls = 0;

  constructor(
    readonly adminExists: boolean,
    readonly profiles: Profile[],
    readonly expiredJobIds: string[] = [],
  ) {}

  prepare(query: string) {
    return new StubStatement(this, query);
  }

  async batch(statements: StubStatement[]) {
    this.batchCalls += 1;
    return statements.map((statement) => {
      const scheduleKey = statement.args[4] as string;
      const changes = this.scheduleKeys.has(scheduleKey) ? 0 : 1;
      this.scheduleKeys.add(scheduleKey);
      return { meta: { changes } };
    });
  }
}

class StubR2 {
  readonly objects = new Set<string>();

  constructor(private readonly failingPrefixes: ReadonlySet<string> = new Set()) {}

  async list({ prefix }: { prefix: string }) {
    if (this.failingPrefixes.has(prefix)) throw new Error(`cleanup unavailable for ${prefix}`);
    return {
      objects: [...this.objects].filter((key) => key.startsWith(prefix)).map((key) => ({ key })),
      truncated: false,
    };
  }

  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
  }
}

const profiles = WEEKLY_PROFILE_USERNAMES.map((username, index) => ({
  id: String(index + 2),
  username,
}));
const scheduledTime = Date.parse("2026-08-17T13:17:00Z");

describe("weekly profile scheduling", () => {
  test("fails closed before writes when the admin identity is unset or missing", async () => {
    const unset = new StubD1(true, profiles);
    await expect(enqueueWeeklyProfiles({ DB: unset as never, DISPATCHES: new StubR2() as never, ADMIN_USER_ID: "" }, scheduledTime))
      .rejects.toThrow("requires ADMIN_USER_ID");
    expect(unset.batchCalls).toBe(0);

    const missing = new StubD1(false, profiles);
    await expect(enqueueWeeklyProfiles({ DB: missing as never, DISPATCHES: new StubR2() as never, ADMIN_USER_ID: "2" }, scheduledTime))
      .rejects.toThrow("admin user is missing");
    expect(missing.batchCalls).toBe(0);
  });

  test("fails closed without partial enqueue when any retained profile is missing", async () => {
    const db = new StubD1(true, profiles.slice(0, -1));
    await expect(enqueueWeeklyProfiles({ DB: db as never, DISPATCHES: new StubR2() as never, ADMIN_USER_ID: "2" }, scheduledTime))
      .rejects.toThrow("profiles are missing: torvalds");
    expect(db.batchCalls).toBe(0);
  });

  test("enqueues the prior completed week once across redelivery", async () => {
    const db = new StubD1(true, profiles);
    expect(await enqueueWeeklyProfiles({ DB: db as never, DISPATCHES: new StubR2() as never, ADMIN_USER_ID: "2" }, scheduledTime)).toEqual({
      weekKey: "2026-W33",
      targets: 9,
      queued: 9,
      deduplicated: 0,
    });
    expect(await enqueueWeeklyProfiles({ DB: db as never, DISPATCHES: new StubR2() as never, ADMIN_USER_ID: "2" }, scheduledTime)).toEqual({
      weekKey: "2026-W33",
      targets: 9,
      queued: 0,
      deduplicated: 9,
    });
  });

  test("keeps eight profiles when one already has a live job", async () => {
    const sqlite = await generationDatabase();
    try {
      const db = new SqliteD1(sqlite);
      sqlite.query("INSERT INTO users(id,username) VALUES (?,?)").run("1", "admin");
      for (const profile of profiles) {
        sqlite.query("INSERT INTO users(id,username) VALUES (?,?)").run(profile.id, profile.username);
      }
      sqlite.query("INSERT INTO generation_jobs(id,user_id,requested_by,week_key,status) VALUES (?,?,?,?,?)")
        .run("existing", profiles.at(-1)!.id, "1", "2026-W33", "queued");

      expect(await enqueueWeeklyProfiles({ DB: db as never, DISPATCHES: new StubR2() as never, ADMIN_USER_ID: "1" }, scheduledTime)).toEqual({
        weekKey: "2026-W33",
        targets: 9,
        queued: 8,
        deduplicated: 1,
      });
      expect(sqlite.query("SELECT COUNT(*) AS count FROM generation_jobs WHERE schedule_key IS NOT NULL").get() as { count: number })
        .toEqual({ count: 8 });
      expect(await enqueueWeeklyProfiles({ DB: db as never, DISPATCHES: new StubR2() as never, ADMIN_USER_ID: "1" }, scheduledTime)).toEqual({
        weekKey: "2026-W33",
        targets: 9,
        queued: 0,
        deduplicated: 9,
      });
    } finally {
      sqlite.close();
    }
  });

  test("skips a runtime-suppressed profile without treating its user row as missing", async () => {
    const sqlite = await generationDatabase();
    try {
      const db = new SqliteD1(sqlite);
      sqlite.query("INSERT INTO users(id,username) VALUES (?,?)").run("1", "admin");
      for (const profile of profiles) {
        sqlite.query("INSERT INTO users(id,username) VALUES (?,?)").run(profile.id, profile.username);
      }
      sqlite.query("INSERT INTO profile_suppressions(username,reason) VALUES (?,?)").run("DHH", "verified opt-out");

      expect(await enqueueWeeklyProfiles({ DB: db as never, DISPATCHES: new StubR2() as never, ADMIN_USER_ID: "1" }, scheduledTime)).toEqual({
        weekKey: "2026-W33",
        targets: 8,
        queued: 8,
        deduplicated: 0,
      });
      expect(sqlite.query(
        "SELECT COUNT(*) AS count FROM generation_jobs j JOIN users u ON u.id=j.user_id WHERE u.username='dhh' COLLATE NOCASE",
      ).get()).toEqual({ count: 0 });
    } finally {
      sqlite.close();
    }
  });

  test("keeps terminal cron redelivery idempotent while allowing an explicit retry", async () => {
    const sqlite = await generationDatabase();
    try {
      const db = new SqliteD1(sqlite);
      sqlite.query("INSERT INTO users(id,username) VALUES (?,?)").run("1", "admin");
      for (const profile of profiles) {
        sqlite.query("INSERT INTO users(id,username) VALUES (?,?)").run(profile.id, profile.username);
      }

      expect((await enqueueWeeklyProfiles({ DB: db as never, DISPATCHES: new StubR2() as never, ADMIN_USER_ID: "1" }, scheduledTime)).queued).toBe(9);
      sqlite.query("UPDATE generation_jobs SET status='permanent_failed' WHERE schedule_key IS NOT NULL").run();

      expect(await enqueueWeeklyProfiles({ DB: db as never, DISPATCHES: new StubR2() as never, ADMIN_USER_ID: "1" }, scheduledTime)).toEqual({
        weekKey: "2026-W33",
        targets: 9,
        queued: 0,
        deduplicated: 9,
      });
      expect(sqlite.query("SELECT COUNT(*) AS count FROM generation_jobs WHERE schedule_key IS NOT NULL").get())
        .toEqual({ count: 9 });

      sqlite.query(
        "INSERT INTO generation_jobs(id,user_id,requested_by,week_key,status) VALUES (?,?,?,?,?)",
      ).run("explicit-retry", profiles[0].id, "1", "2026-W33", "queued");
      expect(sqlite.query("SELECT status,schedule_key FROM generation_jobs WHERE id='explicit-retry'").get())
        .toEqual({ status: "queued", schedule_key: null });
    } finally {
      sqlite.close();
    }
  });

  test("re-enqueues scheduled work that aged out before provider capacity started", async () => {
    const sqlite = await generationDatabase();
    try {
      const db = new SqliteD1(sqlite);
      sqlite.query("INSERT INTO users(id,username) VALUES (?,?)").run("1", "admin");
      for (const profile of profiles) {
        sqlite.query("INSERT INTO users(id,username) VALUES (?,?)").run(profile.id, profile.username);
      }
      const bucket = new StubR2();
      const env = { DB: db as never, DISPATCHES: bucket as never, ADMIN_USER_ID: "1", MAX_QUEUE_AGE_SECONDS: "1" };

      expect((await enqueueWeeklyProfiles(env, scheduledTime)).queued).toBe(9);
      for (const row of sqlite.query("SELECT id FROM generation_jobs WHERE schedule_key IS NOT NULL").all() as { id: string }[]) {
        bucket.objects.add(`staging/${row.id}/lease/image-1.webp`);
      }
      sqlite.query("UPDATE generation_jobs SET created_at=unixepoch()-2 WHERE schedule_key IS NOT NULL").run();

      expect(await enqueueWeeklyProfiles(env, scheduledTime)).toEqual({
        weekKey: "2026-W33",
        targets: 9,
        queued: 9,
        deduplicated: 0,
      });
      expect(sqlite.query(
        "SELECT status,(schedule_key IS NULL) AS cleared,COUNT(*) AS count FROM generation_jobs GROUP BY status,cleared ORDER BY status",
      ).all()).toEqual([
        { status: "permanent_failed", cleared: 1, count: 9 },
        { status: "queued", cleared: 0, count: 9 },
      ]);
      expect(sqlite.query(
        "SELECT COUNT(*) AS count FROM generation_jobs WHERE last_error='scheduled generation aged out before provider start'",
      ).get()).toEqual({ count: 9 });
      expect(bucket.objects.size).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  test("the secondary weekly trigger self-sweeps and re-enqueues without an hourly invocation", async () => {
    const sqlite = await generationDatabase();
    try {
      const db = new SqliteD1(sqlite);
      const bucket = new StubR2();
      sqlite.query("INSERT INTO users(id,username) VALUES (?,?)").run("1", "admin");
      for (const profile of profiles) {
        sqlite.query("INSERT INTO users(id,username) VALUES (?,?)").run(profile.id, profile.username);
      }
      const env = {
        DB: db,
        DISPATCHES: bucket,
        ADMIN_USER_ID: "1",
        MAX_QUEUE_AGE_SECONDS: "21600",
        CLEANUP_SWEEP_ENABLED: "true",
        WEEKLY_GENERATION_ENABLED: "true",
      } as never;

      await runWeeklySchedule(
        { cron: WEEKLY_GENERATION_CRON, scheduledTime } as ScheduledController,
        env,
      );
      sqlite.query("UPDATE generation_jobs SET created_at=unixepoch()-21601 WHERE status='queued'").run();
      await runWeeklySchedule(
        { cron: WEEKLY_GENERATION_RETRY_CRON, scheduledTime: Date.parse("2026-08-17T20:17:00Z") } as ScheduledController,
        env,
      );

      expect(sqlite.query(
        "SELECT status,COUNT(*) AS count FROM generation_jobs GROUP BY status ORDER BY status",
      ).all()).toEqual([
        { status: "permanent_failed", count: 9 },
        { status: "queued", count: 9 },
      ]);
      expect(sqlite.query(
        "SELECT COUNT(*) AS count FROM generation_jobs WHERE schedule_key IS NOT NULL",
      ).get()).toEqual({ count: 9 });
    } finally {
      sqlite.close();
    }
  });

  test("treats the configured string false as disabled until the runner is enabled", async () => {
    const db = new StubD1(true, profiles);
    await runWeeklySchedule(
      { cron: WEEKLY_GENERATION_CRON, scheduledTime } as ScheduledController,
      { DB: db, DISPATCHES: new StubR2(), WEEKLY_GENERATION_ENABLED: "false" } as never,
    );
    expect(db.batchCalls).toBe(0);
    expect(db.staleSweepCalls).toBe(0);
  });

  test("keeps hourly cleanup inert until its separate activation gate is enabled", async () => {
    const db = new StubD1(true, profiles);
    await runWeeklySchedule(
      { cron: JOB_EXPIRY_CRON, scheduledTime } as ScheduledController,
      { DB: db, DISPATCHES: new StubR2(), WEEKLY_GENERATION_ENABLED: "true" } as never,
    );
    expect(db.staleSweepCalls).toBe(0);
    await runWeeklySchedule(
      { cron: JOB_EXPIRY_CRON, scheduledTime } as ScheduledController,
      { DB: db, DISPATCHES: new StubR2(), CLEANUP_SWEEP_ENABLED: "true" } as never,
    );
    expect(db.staleSweepCalls).toBe(1);
    expect(db.batchCalls).toBe(0);
  });

  test("fails closed if weekly generation is enabled before cleanup", async () => {
    const db = new StubD1(true, profiles);
    await expect(runWeeklySchedule(
      { cron: WEEKLY_GENERATION_CRON, scheduledTime } as ScheduledController,
      { DB: db, DISPATCHES: new StubR2(), WEEKLY_GENERATION_ENABLED: "true" } as never,
    )).rejects.toThrow("requires CLEANUP_SWEEP_ENABLED=true");
    expect(db.staleSweepCalls).toBe(0);
    expect(db.batchCalls).toBe(0);
  });

  test("isolates one cleanup failure while the retry sweeps and enqueues remaining work", async () => {
    const failedId = "2bb65583-b570-4a55-b4e4-5de336b10664";
    const cleanedId = "839d37cd-7e82-4a10-8442-100176b96805";
    const db = new StubD1(true, profiles, [failedId, cleanedId]);
    const bucket = new StubR2(new Set([`staging/${failedId}/`]));
    bucket.objects.add(`staging/${cleanedId}/lease/image-1.webp`);
    const error = spyOn(console, "error").mockImplementation(() => {});
    let cleanupLog = "";
    try {
      await runWeeklySchedule(
        { cron: WEEKLY_GENERATION_RETRY_CRON, scheduledTime: Date.parse("2026-08-17T20:17:00Z") } as ScheduledController,
        {
          DB: db,
          DISPATCHES: bucket,
          ADMIN_USER_ID: "2",
          MAX_QUEUE_AGE_SECONDS: "21600",
          CLEANUP_SWEEP_ENABLED: "true",
          WEEKLY_GENERATION_ENABLED: "true",
        } as never,
      );
    } finally {
      cleanupLog = String(error.mock.calls[0]?.[0] ?? "");
      error.mockRestore();
    }

    expect(db.staleSweepCalls).toBe(1);
    expect(db.batchCalls).toBe(1);
    expect(bucket.objects.size).toBe(0);
    expect(cleanupLog).toContain(`"jobId":"${failedId}"`);
  });

  test("expires manual work and removes staging while weekly enqueue stays disabled", async () => {
    const sqlite = await generationDatabase();
    try {
      const db = new SqliteD1(sqlite);
      const bucket = new StubR2();
      sqlite.query("INSERT INTO users(id,username) VALUES ('1','admin')").run();
      sqlite.query("INSERT INTO sessions(token,user_id,expires_at) VALUES ('disabled-weekly','1',unixepoch()+3600)").run();
      const staleJobId = "2bb65583-b570-4a55-b4e4-5de336b10664";
      sqlite.query(
        "INSERT INTO generation_jobs(id,user_id,requested_by,week_key,status,created_at) VALUES (?,?,?,?,?,unixepoch()-2)",
      ).run(staleJobId, "1", "1", "2026-W33", "queued");
      bucket.objects.add(`staging/${staleJobId}/lease/image-1.webp`);

      const env = {
        DB: db,
        DISPATCHES: bucket,
        MAX_QUEUE_AGE_SECONDS: "1",
        CLEANUP_SWEEP_ENABLED: "true",
        WEEKLY_GENERATION_ENABLED: "false",
        RUNNER_SECRET: "expected",
        ROLLING_7D_GLOBAL_GENERATION_LIMIT: "100",
      } as never;
      await runWeeklySchedule(
        { cron: WEEKLY_GENERATION_CRON, scheduledTime } as ScheduledController,
        env,
      );

      expect(sqlite.query("SELECT status,last_error FROM generation_jobs WHERE id=?").get(staleJobId))
        .toEqual({ status: "permanent_failed", last_error: "generation runner unavailable; please retry" });
      expect(bucket.objects.size).toBe(0);

      const app = new Hono()
        .route("/", queueRoutes as never)
        .route("/runner", runnerRoutes as never);
      const status = await app.request(
        "/generate/status",
        { headers: { cookie: "session=disabled-weekly" } },
        env,
      );
      expect(status.status).toBe(200);
      expect(await status.json()).toMatchObject({ status: "failed", stage: "permanent_failed" });
      const claim = await app.request(
        "/runner/jobs/claim",
        { method: "POST", headers: { authorization: "Bearer expected" } },
        env,
      );
      expect(claim.status).toBe(204);
    } finally {
      sqlite.close();
    }
  });

  test("couples hourly expiry and redundant weekly triggers to the handler", async () => {
    const config = await Bun.file("wrangler.toml").text();
    expect(config).toMatch(/^CLEANUP_SWEEP_ENABLED\s*=\s*"false"$/m);
    const configured = config.match(/^crons\s*=\s*(\[[^\n]+\])\s*$/m);
    expect(configured).not.toBeNull();
    expect(JSON.parse(configured![1])).toEqual([JOB_EXPIRY_CRON, ...WEEKLY_GENERATION_CRONS]);
    for (const cron of WEEKLY_GENERATION_CRONS) {
      const [minute, hour, dayOfMonth, month, dayOfWeek] = cron.split(" ");
      expect([dayOfMonth, month, dayOfWeek]).toEqual(["*", "*", "1"]);
      expect(Number(hour) * 60 + Number(minute)).toBeGreaterThanOrEqual(AOE_LAG_MS / 60_000);
    }
    const configuredMaxAge = Number(config.match(/^MAX_QUEUE_AGE_SECONDS\s*=\s*"(\d+)"\s*$/m)?.[1]);
    const weeklyMinutes = WEEKLY_GENERATION_CRONS.map((cron) => {
      const [minute, hour] = cron.split(" ").map(Number);
      return hour * 60 + minute;
    });
    expect(weeklyMinutes[1] - weeklyMinutes[0]).toBeGreaterThan(configuredMaxAge / 60);
    expect(JOB_EXPIRY_CRON.split(" ").slice(1)).toEqual(["*", "*", "*", "*"]);
    await expect(runWeeklySchedule({ cron: "* * * * *", scheduledTime } as ScheduledController, {} as never))
      .rejects.toThrow("unexpected generation cron");
  });
});

type SqlValue = string | number | bigint | boolean | Uint8Array | null;

class SqliteStatement {
  args: unknown[] = [];

  constructor(
    private readonly db: Database,
    readonly query: string,
  ) {}

  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }

  async first<T>() {
    return this.db.query(this.query).get(...this.args as SqlValue[]) as T | null;
  }

  async all<T>() {
    return { results: this.db.query(this.query).all(...this.args as SqlValue[]) as T[] } as D1Result<T>;
  }

  async run() {
    return this.execute();
  }

  execute() {
    const result = this.db.query(this.query).run(...this.args as SqlValue[]);
    return { meta: { changes: Number(result.changes) } };
  }
}

class SqliteD1 {
  constructor(private readonly db: Database) {}

  prepare(query: string) {
    return new SqliteStatement(this.db, query);
  }

  async batch(statements: SqliteStatement[]) {
    return this.db.transaction((items: SqliteStatement[]) => items.map((statement) => statement.execute()))(statements);
  }
}

async function generationDatabase(): Promise<Database> {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(await Bun.file("migrations/0000_base.sql").text());
  db.exec(await Bun.file("migrations/0001_generation_queue.sql").text());
  db.exec(await Bun.file("migrations/0002_weekly_generation_schedule.sql").text());
  db.exec(await Bun.file("migrations/0003_remove_legacy_generating_dispatch.sql").text());
  db.exec(await Bun.file("migrations/0004_normalize_github_usernames.sql").text());
  db.exec(await Bun.file("migrations/0005_profile_suppressions.sql").text());
  return db;
}
