import { describe, expect, test } from "bun:test";
import { productionBaselineFixture } from "./production-baseline-from-json";

describe("production baseline raw-capture derivation", () => {
  test("mechanically converts a strict Wrangler envelope into the reviewed fixture", () => {
    const fixture = productionBaselineFixture([{ success: true, results: [
      { type: "table", name: "users", sql: 'CREATE TABLE "users" (id TEXT)' },
      { type: "index", name: "sqlite_autoindex_users_1", sql: null },
    ] }], "2026-08-15");
    expect(fixture).toContain("captured 2026-08-15. Mechanical derivation");
    expect(fixture).toContain("CREATE TABLE users(id TEXT);");
    expect(fixture).not.toContain("sqlite_autoindex_users_1");
  });

  test("rejects malformed/error envelopes and unbound capture dates", () => {
    expect(() => productionBaselineFixture({ results: [] }, "2026-08-15")).toThrow("invalid Wrangler schema result");
    expect(() => productionBaselineFixture([{ error: "unauthorized" }], "2026-08-15")).toThrow("invalid Wrangler schema result");
    expect(() => productionBaselineFixture([{ results: [] }], "today")).toThrow("capture date");
  });
});
