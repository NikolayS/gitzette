import { describe, expect, test } from "bun:test";
import { WEEKLY_PROFILE_USERNAMES } from "./highlighted";
import { enqueueWeeklyProfiles, runWeeklySchedule, WEEKLY_GENERATION_CRON } from "./schedule";

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

  test("couples the configured trigger to the only accepted handler cron", async () => {
    const config = await Bun.file("wrangler.toml").text();
    expect(config).toContain(`crons = ["${WEEKLY_GENERATION_CRON}"]`);
    await expect(runWeeklySchedule({ cron: "* * * * *", scheduledTime } as ScheduledController, {} as never))
      .rejects.toThrow("unexpected generation cron");
  });
});
