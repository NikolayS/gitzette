import { describe, expect, test } from "bun:test";
import { failureBackoffSeconds } from "./backoff";

describe("runner failure backoff", () => {
  test("grows exponentially and caps at fifteen minutes", () => {
    expect(failureBackoffSeconds(0, 10)).toBe(10);
    expect(failureBackoffSeconds(1, 10)).toBe(20);
    expect(failureBackoffSeconds(4, 10)).toBe(160);
    expect(failureBackoffSeconds(20, 10)).toBe(900);
    expect(failureBackoffSeconds(0, 300)).toBe(300);
    expect(failureBackoffSeconds(1, 300)).toBe(600);
    expect(failureBackoffSeconds(0, 1_800)).toBe(900);
    expect(failureBackoffSeconds(1, 1_800)).toBe(900);
  });

  test("fails closed for fractional, negative, and non-finite input", () => {
    expect(failureBackoffSeconds(-1, 10)).toBe(10);
    expect(failureBackoffSeconds(1.9, 10)).toBe(20);
    expect(failureBackoffSeconds(Number.NaN, 10)).toBe(900);
    expect(failureBackoffSeconds(Number.POSITIVE_INFINITY, 10)).toBe(900);
    expect(failureBackoffSeconds(1, Number.NaN)).toBe(900);
    expect(failureBackoffSeconds(1, -10)).toBe(900);
  });
});
