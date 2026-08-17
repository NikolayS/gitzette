import { describe, expect, test } from "bun:test";
import {
  ALL_STATUSES,
  LIVE_STATUSES,
  MAX_GENERATE_BODY_BYTES,
  blocksDuplicate,
  hasGenerationRequestCapacity,
  hasRunnerCapacity,
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

  test("queues user-eligible work while applying global capacity only to runner starts", () => {
    expect(hasGenerationRequestCapacity(2, 3)).toBe(true);
    expect(hasGenerationRequestCapacity(3, 3)).toBe(false);
    expect(hasGenerationRequestCapacity(4, 3)).toBe(false);
    expect(hasGenerationRequestCapacity(50, 3, true)).toBe(true);

    expect(hasRunnerCapacity(99, 100)).toBe(true);
    expect(hasRunnerCapacity(100, 100)).toBe(false);
    expect(hasRunnerCapacity(101, 100)).toBe(false);
    expect(hasRunnerCapacity(100, 100, true)).toBe(true);
  });

  test("fails closed when the immutable admin principal is unset or does not match", () => {
    expect(isAdmin("1345402", undefined)).toBe(false);
    expect(isAdmin("1345402", "")).toBe(false);
    expect(isAdmin("intruder", "1345402")).toBe(false);
    expect(isAdmin("1345402", "1345402")).toBe(true);
  });

  test("deduplicates every live status but not terminal states", () => {
    for (const status of LIVE_STATUSES) expect(blocksDuplicate(status)).toBe(true);
    expect(blocksDuplicate("published")).toBe(false);
    expect(blocksDuplicate("permanent_failed")).toBe(false);
  });

  test("keeps migration status constraints and the live partial index coupled to TypeScript", async () => {
    const migration = await Bun.file("migrations/0001_generation_queue.sql").text();
    const check = migration.match(/status\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(status\s+IN\s*\(([\s\S]*?)\)\s*\)/i);
    const liveIndex = migration.match(/CREATE\s+UNIQUE\s+INDEX\s+generation_jobs_one_live_job[\s\S]*?WHERE\s+status\s+IN\s*\(([\s\S]*?)\)\s*;/i);
    expect(check).not.toBeNull();
    expect(liveIndex).not.toBeNull();
    expect(sqlStringSet(check![1])).toEqual(new Set(ALL_STATUSES));
    expect(sqlStringSet(liveIndex![1])).toEqual(new Set(LIVE_STATUSES));
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
