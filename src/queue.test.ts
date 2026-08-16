import { describe, expect, test } from "bun:test";
import {
  LIVE_STATUSES,
  MAX_GENERATE_BODY_BYTES,
  blocksDuplicate,
  hasGenerationCapacity,
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

  test("applies user and global capacity at exact boundaries", () => {
    expect(hasGenerationCapacity(2, 98, 3, 100)).toBe(true);
    expect(hasGenerationCapacity(3, 98, 3, 100)).toBe(false);
    expect(hasGenerationCapacity(4, 98, 3, 100)).toBe(false);
    expect(hasGenerationCapacity(2, 100, 3, 100)).toBe(false);
    expect(hasGenerationCapacity(2, 101, 3, 100)).toBe(false);
    expect(hasGenerationCapacity(50, 99, 3, 100, true)).toBe(true);
    expect(hasGenerationCapacity(50, 100, 3, 100, true)).toBe(false);
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
