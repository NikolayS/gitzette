import { describe, expect, test } from "bun:test";
import { combineTokenUsage, measuredOrEstimatedUsage, validateJobUsage } from "./usage";
import type { JobUsage } from "./usage";

describe("generation usage telemetry", () => {
  test("uses provider counts when present and explicitly labels deterministic estimates", () => {
    expect(measuredOrEstimatedUsage({ usage: { inputTokens: 12, outputTokens: 3 } }, "long input", "output"))
      .toEqual({ inputTokens: 12, outputTokens: 3, tokenSource: "provider" });
    const estimated = measuredOrEstimatedUsage({}, "12345678", "1234");
    expect(estimated).toEqual({ inputTokens: 2, outputTokens: 1, tokenSource: "estimated" });
    expect(combineTokenUsage(
      { inputTokens: 12, outputTokens: 3, tokenSource: "provider" },
      estimated,
    )).toEqual({ inputTokens: 14, outputTokens: 4, tokenSource: "estimated" });
  });

  test("accepts only bounded exact publish telemetry", () => {
    const valid: JobUsage = { inputTokens: 120, outputTokens: 20, tokenSource: "estimated", imageCount: 2, wallTimeMs: 30_000 };
    expect(validateJobUsage(valid)).toEqual(valid);
    expect(() => validateJobUsage({ ...valid, imageCount: 4 })).toThrow("invalid job usage");
    expect(() => validateJobUsage({ ...valid, wallTimeMs: -1 })).toThrow("invalid job usage");
    expect(() => validateJobUsage({ ...valid, tokenSource: "none" })).toThrow("requires zero tokens");
    expect(() => validateJobUsage({ ...valid, tokenSource: ["provider"] })).toThrow("invalid job usage");
    expect(() => validateJobUsage({ ...valid, usd: 1 })).toThrow("unknown job usage field");
  });
});
