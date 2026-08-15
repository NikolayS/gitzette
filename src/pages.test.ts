import { describe, expect, test } from "bun:test";
import { secretMatches } from "./pages";

describe("status dashboard credential", () => {
  test("uses a separate hashed comparison and fails closed when unconfigured", async () => {
    expect(await secretMatches("status-secret", "status-secret")).toBe(true);
    expect(await secretMatches("status-secret", "different")).toBe(false);
    expect(await secretMatches("undefined", undefined)).toBe(false);
    expect(await secretMatches("anything", "")).toBe(false);
  });
});
