import { describe, expect, test } from "bun:test";
import { cutoverState } from "./cutover-state";

describe("production cutover state", () => {
  test("runs the baseline gate only before the migration ledger exists", () => {
    expect(cutoverState([{ results: [{ total: 0 }] }], null)).toBe("cutover");
    expect(cutoverState([{ results: [{ total: 1 }] }], [{ results: [{ name: "0000_base.sql" }] }])).toBe("migrated");
    expect(() => cutoverState([{ results: [{ total: 1 }] }], [{ results: [] }])).toThrow("without 0000_base.sql");
    expect(() => cutoverState([{ results: [{ total: 1 }] }], undefined)).toThrow("contents are required");
    expect(() => cutoverState([{ results: [{ total: 1 }] }], {})).toThrow("contents are required");
    expect(() => cutoverState([{ results: [] }], null)).toThrow("invalid D1");
  });
});
