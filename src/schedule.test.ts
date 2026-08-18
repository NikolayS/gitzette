import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { WEEKLY_PROFILE_USERNAMES } from "./highlighted";
import { enqueueWeeklyProfiles, runWeeklySchedule, WEEKLY_GENERATION_CRON } from "./schedule";
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
    if (!this.query.startsWith("SELECT id,username FROM users")) throw new Error(`unexpected all: ${this.query}`);
    return { results: this.db.profiles } as D1Result<T>;
  }

  async run() {
    if (!this.query.startsWith("UPDATE generation_jobs")) throw new Error(`unexpected run: ${this.query}`);
    return { meta: { changes: 0 } };
  }
}

class StubD1 {
  readonly scheduleKeys = new Set<string>();
  batchCalls = 0;

  constructor(
    readonly adminExists: boolean,
    readonly profiles: Profile[],
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

const profiles = WEEKLY_PROFILE_USERNAMES.map((username, index) => ({
  id: String(index + 2),
  username,
}));
const scheduledTime = Date.parse("2026-08-17T13:17:00Z");

describe("weekly profile scheduling", () => {
  test("fails closed before writes when the admin identity is unset or missing", async () => {
    const unset = new StubD1(true, profiles);
    await expect(enqueueWeeklyProfiles({ DB: unset as never, ADMIN_USER_ID: "" }, scheduledTime))
      .rejects.toThrow("requires ADMIN_USER_ID");
    expect(unset.batchCalls).toBe(0);

    const missing = new StubD1(false, profiles);
    await expect(enqueueWeeklyProfiles({ DB: missing as never, ADMIN_USER_ID: "2" }, scheduledTime))
      .rejects.toThrow("admin user is missing");
    expect(missing.batchCalls).toBe(0);
  });

  test("fails closed without partial enqueue when any retained profile is missing", async () => {
    const db = new StubD1(true, profiles.slice(0, -1));
    await expect(enqueueWeeklyProfiles({ DB: db as never, ADMIN_USER_ID: "2" }, scheduledTime))
      .rejects.toThrow("profiles are missing: torvalds");
    expect(db.batchCalls).toBe(0);
  });

  test("enqueues the prior completed week once across redelivery", async () => {
    const db = new StubD1(true, profiles);
    expect(await enqueueWeeklyProfiles({ DB: db as never, ADMIN_USER_ID: "2" }, scheduledTime)).toEqual({
      weekKey: "2026-W33",
      targets: 9,
      queued: 9,
      deduplicated: 0,
    });
    expect(await enqueueWeeklyProfiles({ DB: db as never, ADMIN_USER_ID: "2" }, scheduledTime)).toEqual({
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

      expect(await enqueueWeeklyProfiles({ DB: db as never, ADMIN_USER_ID: "1" }, scheduledTime)).toEqual({
        weekKey: "2026-W33",
        targets: 9,
        queued: 8,
        deduplicated: 1,
      });
      expect(sqlite.query("SELECT COUNT(*) AS count FROM generation_jobs WHERE schedule_key IS NOT NULL").get() as { count: number })
        .toEqual({ count: 8 });
      expect(await enqueueWeeklyProfiles({ DB: db as never, ADMIN_USER_ID: "1" }, scheduledTime)).toEqual({
        weekKey: "2026-W33",
        targets: 9,
        queued: 0,
        deduplicated: 9,
      });
    } finally {
      sqlite.close();
    }
  });

  test("re-enqueues a scheduled profile after its prior job permanently fails", async () => {
    const sqlite = await generationDatabase();
    try {
      const db = new SqliteD1(sqlite);
      sqlite.query("INSERT INTO users(id,username) VALUES (?,?)").run("1", "admin");
      for (const profile of profiles) {
        sqlite.query("INSERT INTO users(id,username) VALUES (?,?)").run(profile.id, profile.username);
      }

      expect((await enqueueWeeklyProfiles({ DB: db as never, ADMIN_USER_ID: "1" }, scheduledTime)).queued).toBe(9);
      const scheduleKey = `2026-W33:${profiles[0].id}`;
      sqlite.query("UPDATE generation_jobs SET status='permanent_failed' WHERE schedule_key=?").run(scheduleKey);

      expect(await enqueueWeeklyProfiles({ DB: db as never, ADMIN_USER_ID: "1" }, scheduledTime)).toEqual({
        weekKey: "2026-W33",
        targets: 9,
        queued: 1,
        deduplicated: 8,
      });
      expect(sqlite.query(
        "SELECT status,COUNT(*) AS count FROM generation_jobs WHERE schedule_key=? GROUP BY status ORDER BY status",
      ).all(scheduleKey)).toEqual([
        { status: "permanent_failed", count: 1 },
        { status: "queued", count: 1 },
      ]);
    } finally {
      sqlite.close();
    }
  });

  test("keeps the production scheduler inert until the runner is enabled", async () => {
    const db = new StubD1(true, profiles);
    await runWeeklySchedule(
      { cron: WEEKLY_GENERATION_CRON, scheduledTime } as ScheduledController,
      { DB: db, WEEKLY_GENERATION_ENABLED: "false" } as never,
    );
    expect(db.batchCalls).toBe(0);
  });

  test("couples the configured trigger to the only accepted handler cron", async () => {
    const config = await Bun.file("wrangler.toml").text();
    const configuredCrons = [...config.matchAll(/^crons\s*=\s*\["([^"]+)"\]\s*$/gm)];
    expect(configuredCrons).toHaveLength(1);
    expect(configuredCrons[0][1]).toBe(WEEKLY_GENERATION_CRON);
    const [minute, hour, dayOfMonth, month, dayOfWeek] = WEEKLY_GENERATION_CRON.split(" ");
    expect([dayOfMonth, month, dayOfWeek]).toEqual(["*", "*", "1"]);
    expect(Number(hour) * 60 + Number(minute)).toBeGreaterThanOrEqual(AOE_LAG_MS / 60_000);
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
  db.exec(await Bun.file("migrations/0000_base.sql").text());
  db.exec(await Bun.file("migrations/0001_generation_queue.sql").text());
  db.exec(await Bun.file("migrations/0002_weekly_generation_schedule.sql").text());
  return db;
}
