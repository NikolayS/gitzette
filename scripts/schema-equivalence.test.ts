import { describe, expect, test } from "bun:test";
import { canonicalSchema, schemasMatch } from "./schema-equivalence";

describe("schema equivalence", () => {
  const schema = (sql: string) => [{ results: [{ type: "table", name: "jobs", sql }] }];

  test("normalizes reviewed DDL differences but rejects column drift", () => {
    expect(schemasMatch(
      schema("CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, state TEXT)"),
      schema('CREATE TABLE "jobs"(id TEXT PRIMARY KEY,state TEXT)'),
    )).toBe(true);
    expect(schemasMatch(
      schema("CREATE TABLE jobs(id TEXT PRIMARY KEY,state TEXT)"),
      schema("CREATE TABLE jobs(id TEXT PRIMARY KEY,state TEXT,owner TEXT)"),
    )).toBe(false);
    expect(() => canonicalSchema([{ results: [{ name: "jobs" }] }])).toThrow("invalid Wrangler schema row");
  });
});
