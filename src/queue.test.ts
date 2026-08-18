import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  ALL_STATUSES,
  GENERATION_REQUEST_INSERT_SQL,
  LIVE_STATUSES,
  MAX_GENERATE_BODY_BYTES,
  isAdmin,
  isGenerateBodyTooLarge,
  maxQueueAgeSeconds,
  positiveInteger,
  publicFailureCode,
} from "./queue";
import { isCompletedIsoWeekKey } from "./week";

describe("generation queue policy", () => {
  test("enforces the request-body boundary exactly", () => {
    expect(isGenerateBodyTooLarge(MAX_GENERATE_BODY_BYTES)).toBe(false);
    expect(isGenerateBodyTooLarge(MAX_GENERATE_BODY_BYTES + 1)).toBe(true);
  });

  test("rejects malformed, future, and incomplete ISO weeks", () => {
    const now = new Date("2026-08-15T00:00:00Z");
    expect(isCompletedIsoWeekKey("banana", now)).toBe(false);
    expect(isCompletedIsoWeekKey("2026-W33", now)).toBe(false);
    expect(isCompletedIsoWeekKey("2026-W32", now)).toBe(true);
  });

  test("executes the production admission SQL for user limits and admin bypass", async () => {
    const db = await generationDatabase();
    try {
      db.query("INSERT INTO users(id,username) VALUES ('1','requester')").run();
      const insert = db.query(GENERATION_REQUEST_INSERT_SQL);
      expect(insert.run("a", "1", "1", "2026-W30", 0, "1", 2).changes).toBe(1);
      expect(insert.run("b", "1", "1", "2026-W31", 0, "1", 2).changes).toBe(1);
      expect(insert.run("c", "1", "1", "2026-W32", 0, "1", 2).changes).toBe(0);
      expect(insert.run("d", "1", "1", "2026-W32", 1, "1", 2).changes).toBe(1);
    } finally {
      db.close();
    }
  });

  test("fails closed when the immutable admin principal is unset or does not match", () => {
    expect(isAdmin("1345402", undefined)).toBe(false);
    expect(isAdmin("1345402", "")).toBe(false);
    expect(isAdmin("intruder", "1345402")).toBe(false);
    expect(isAdmin("1345402", "1345402")).toBe(true);
  });

  test("keeps migration status constraints and the live partial index coupled to TypeScript", async () => {
    const migration = await Bun.file("migrations/0001_generation_queue.sql").text();
    const check = migration.match(/status\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(status\s+IN\s*\(([\s\S]*?)\)\s*\)/i);
    const liveIndex = migration.match(/CREATE\s+UNIQUE\s+INDEX\s+generation_jobs_one_live_job[\s\S]*?WHERE\s+status\s+IN\s*\(([\s\S]*?)\)\s*;/i);
    expect(check).not.toBeNull();
    expect(liveIndex).not.toBeNull();
    expect(sqlStringSet(check![1])).toEqual(new Set(ALL_STATUSES));
    expect(sqlStringSet(liveIndex![1])).toEqual(new Set(LIVE_STATUSES));
    expect(migration).toContain("generation_jobs_expiry");
  });

  test("bounds queue-age configuration to positive integers", () => {
    expect(maxQueueAgeSeconds({ MAX_QUEUE_AGE_SECONDS: "17" } as never)).toBe(17);
    expect(maxQueueAgeSeconds({ MAX_QUEUE_AGE_SECONDS: "0" } as never)).toBe(21_600);
    expect(positiveInteger("2.5", 9)).toBe(9);
  });

  test("maps private provider diagnostics to bounded public reason codes", () => {
    expect(publicFailureCode("GitHub search incomplete: /secret/path")).toBe("evidence_incomplete");
    expect(publicFailureCode("illustration validator failed: stderr token=secret")).toBe("validation_failed");
    expect(publicFailureCode("OpenClaw failed: /home/runner/private")).toBe("provider_unavailable");
  });
});

function sqlStringSet(fragment: string): Set<string> {
  return new Set([...fragment.matchAll(/'([^']+)'/g)].map((match) => match[1]));
}

async function generationDatabase(): Promise<Database> {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(await Bun.file("migrations/0000_base.sql").text());
  db.exec(await Bun.file("migrations/0001_generation_queue.sql").text());
  return db;
}
