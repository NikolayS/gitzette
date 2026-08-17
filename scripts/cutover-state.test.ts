import { describe, expect, test } from "bun:test";
import { cutoverState } from "./cutover-state";

describe("production cutover state", () => {
  test("runs the baseline gate only before the migration ledger exists", () => {
    expect(cutoverState([{ results: [{ total: 0 }] }], null)).toBe("cutover");
    expect(cutoverState([{ results: [{ total: 1 }] }], [{ results: [{ name: "0000_base.sql" }] }])).toBe("migrated");
    expect(() => cutoverState([{ results: [{ total: 1 }] }], [{ results: [] }])).toThrow("without 0000_base.sql");
  });

  test.each([
    ["missing document", undefined, null],
    ["empty document", [], null],
    ["missing result row", [{ results: [] }], null],
    ["string total", [{ results: [{ total: "1" }] }], null],
  ])("throws for %s", (_label, document, ledger) => {
    expect(() => cutoverState(document, ledger)).toThrow("invalid D1 migration-ledger query result");
  });

  test.each([
    ["null ledger", null],
    ["missing ledger results", {}],
    ["non-array ledger results", [{ results: null }]],
    ["missing baseline row", [{ results: [{}] }]],
    ["wrong baseline row", [{ results: [{ name: "0001_generation_queue.sql" }] }]],
  ])("throws for a non-zero total with %s", (_label, ledger) => {
    expect(() => cutoverState([{ results: [{ total: 1 }] }], ledger)).toThrow();
  });
});
