import { describe, expect, test } from "bun:test";
import { isCompletedIsoWeekKey, parseIsoWeekKey, previousCompletedIsoWeekKey } from "./week";

describe("ISO week validation", () => {
  test("parses year-boundary weeks", () => {
    expect(parseIsoWeekKey("2026-W01").monday.toISOString().slice(0, 10)).toBe("2025-12-29");
    expect(parseIsoWeekKey("2026-W53").monday.toISOString().slice(0, 10)).toBe("2026-12-28");
  });

  test("rejects nonexistent week 53 and incomplete weeks", () => {
    expect(() => parseIsoWeekKey("2025-W53")).toThrow("operating range");
    expect(isCompletedIsoWeekKey("2025-W53", new Date("2026-02-01T00:00:00Z"))).toBe(false);
    expect(() => parseIsoWeekKey("2027-W53")).toThrow("does not exist");
    expect(isCompletedIsoWeekKey("2026-W32", new Date("2026-08-14T08:00:00Z"))).toBe(true);
    expect(isCompletedIsoWeekKey("2026-W33", new Date("2026-08-14T08:00:00Z"))).toBe(false);
  });

  test("uses an explicit operating range without rejecting the next century", () => {
    expect(() => parseIsoWeekKey("2025-W52", new Date("2026-08-18T00:00:00Z"))).toThrow("operating range");
    expect(() => parseIsoWeekKey("2028-W01", new Date("2026-08-18T00:00:00Z"))).toThrow("operating range");
    expect(parseIsoWeekKey("2100-W01", new Date("2100-01-10T00:00:00Z")).year).toBe(2100);
  });

  test("selects the previous globally completed week", () => {
    expect(previousCompletedIsoWeekKey(new Date("2026-08-14T08:00:00Z"))).toBe("2026-W32");
  });
});
