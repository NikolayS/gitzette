import { describe, expect, test } from "bun:test";
import { failureBackoffSeconds } from "./backoff";

describe("runner failure backoff", () => {
  test("grows exponentially and caps at fifteen minutes", () => {
    expect(failureBackoffSeconds(0, 10)).toBe(10);
    expect(failureBackoffSeconds(1, 10)).toBe(20);
    expect(failureBackoffSeconds(4, 10)).toBe(160);
    expect(failureBackoffSeconds(20, 10)).toBe(900);
  });
});
