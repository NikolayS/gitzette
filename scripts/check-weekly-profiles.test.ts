import { describe, expect, test } from "bun:test";
import { WEEKLY_PROFILE_USERNAMES } from "../src/highlighted";
import { missingWeeklyProfiles } from "./check-weekly-profiles";

describe("weekly profile activation preflight", () => {
  test("requires every retained profile case-insensitively", () => {
    const rows = WEEKLY_PROFILE_USERNAMES.slice(0, -1).map((username) => ({ username: username.toUpperCase() }));
    expect(missingWeeklyProfiles([{ results: rows }])).toEqual(["torvalds"]);
    expect(missingWeeklyProfiles([{ results: [...rows, { username: "TORVALDS" }] }])).toEqual([]);
  });

  test("fails closed on malformed Wrangler output", () => {
    expect(() => missingWeeklyProfiles({})).toThrow("invalid Wrangler users result");
    expect(() => missingWeeklyProfiles([{ results: [{ login: "NikolayS" }] }])).toThrow("invalid Wrangler username row");
  });
});
