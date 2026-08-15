import { describe, expect, test } from "bun:test";
import { cutoverState } from "./cutover-state";

describe("production cutover state", () => {
  test("runs the baseline gate only before the migration ledger exists", () => {
    expect(cutoverState([{ results: [{ total: 0 }] }])).toBe("cutover");
    expect(cutoverState([{ results: [{ total: 1 }] }])).toBe("migrated");
    expect(() => cutoverState([{ results: [] }])).toThrow("invalid D1");
  });
});
