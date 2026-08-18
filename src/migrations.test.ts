import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

describe("weekly generation data migration", () => {
  test("removes only the unbacked legacy generating sentinel", async () => {
    const db = new Database(":memory:");
    try {
      db.exec(await Bun.file("migrations/0000_base.sql").text());
      db.exec(await Bun.file("migrations/0001_generation_queue.sql").text());
      db.query("INSERT INTO users(id,username) VALUES ('1','octocat')").run();
      db.query("INSERT INTO dispatches(user_id,week_key) VALUES ('1','generating')").run();
      db.query("INSERT INTO dispatches(user_id,week_key,html,r2_key) VALUES ('1','2026-W30','edition','editions/octocat/2026-W30/live.html')").run();

      db.exec(await Bun.file("migrations/0002_weekly_generation_schedule.sql").text());
      db.exec(await Bun.file("migrations/0003_remove_legacy_generating_dispatch.sql").text());

      expect(db.query("SELECT week_key,r2_key FROM dispatches ORDER BY week_key").all())
        .toEqual([{ week_key: "2026-W30", r2_key: "editions/octocat/2026-W30/live.html" }]);
      expect(db.query("SELECT COUNT(*) AS count FROM dispatches WHERE week_key='generating'").get())
        .toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });
});
