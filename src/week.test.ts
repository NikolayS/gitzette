import { describe, expect, test } from "bun:test";
import {
  isCompletedIsoWeekKey,
  isGeneratableCompletedIsoWeekKey,
  parseIsoWeekKey,
  previousCompletedIsoWeekKey,
} from "./week";

describe("ISO week validation", () => {
  test("parses year-boundary weeks", () => {
    expect(parseIsoWeekKey("2026-W01").monday.toISOString().slice(0, 10)).toBe("2025-12-29");
    expect(parseIsoWeekKey("2026-W53").monday.toISOString().slice(0, 10)).toBe("2026-12-28");
  });

  test("rejects nonexistent week 53 and incomplete weeks", () => {
    expect(() => parseIsoWeekKey("2025-W53")).toThrow("does not exist");
    expect(isCompletedIsoWeekKey("2025-W53", new Date("2026-02-01T00:00:00Z"))).toBe(false);
    expect(() => parseIsoWeekKey("2027-W53")).toThrow("does not exist");
    expect(isCompletedIsoWeekKey("2026-W32", new Date("2026-08-14T08:00:00Z"))).toBe(true);
    expect(isCompletedIsoWeekKey("2026-W33", new Date("2026-08-14T08:00:00Z"))).toBe(false);
  });

  test("separates calendar reads from the generation operating range", () => {
    const now = new Date("2026-08-18T00:00:00Z");
    expect(parseIsoWeekKey("2025-W52").year).toBe(2025);
    expect(isCompletedIsoWeekKey("2025-W52", now)).toBe(true);
    expect(isGeneratableCompletedIsoWeekKey("2025-W52", now)).toBe(false);
    expect(isGeneratableCompletedIsoWeekKey("2026-W32", now)).toBe(true);
    expect(isGeneratableCompletedIsoWeekKey("2028-W01", now)).toBe(false);
    expect(parseIsoWeekKey("2100-W01").year).toBe(2100);
  });

  test("selects the previous globally completed week", () => {
    expect(previousCompletedIsoWeekKey(new Date("2026-08-14T08:00:00Z"))).toBe("2026-W32");
  });
});
