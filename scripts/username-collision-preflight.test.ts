import { describe, expect, test } from "bun:test";
import { assertNoUsernameCollisions } from "./username-collision-preflight";

describe("production username collision preflight", () => {
  test("accepts an exact empty Wrangler result", () => {
    expect(() => assertNoUsernameCollisions([{ success: true, results: [] }])).not.toThrow();
  });

  test("fails closed on collisions and malformed envelopes", () => {
    expect(() => assertNoUsernameCollisions([
      { success: true, results: [{ username: "nik", total: 2 }] },
    ])).toThrow("production contains case-folding GitHub username collisions");
    for (const value of [[], [{ success: false, results: [] }], [{ error: "denied", results: [] }], [{}]]) {
      expect(() => assertNoUsernameCollisions(value)).toThrow(
        "invalid production username-collision preflight response",
      );
    }
  });
});
