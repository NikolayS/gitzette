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

  test("preserves literal whitespace and compares nullable implicit objects by name", () => {
    expect(schemasMatch(
      schema("CREATE TABLE jobs(id TEXT DEFAULT 'a  b')"),
      schema("CREATE TABLE jobs(id TEXT DEFAULT 'a b')"),
    )).toBe(false);
    expect(schemasMatch(
      [{ results: [{ type: "index", name: "sqlite_autoindex_jobs_1", sql: null }] }],
      [{ results: [{ type: "index", name: "sqlite_autoindex_jobs_1", sql: null }] }],
    )).toBe(true);
    expect(schemasMatch(
      [{ results: [{ type: "index", name: "sqlite_autoindex_jobs_1", sql: null }] }],
      [{ results: [{ type: "index", name: "sqlite_autoindex_jobs_2", sql: null }] }],
    )).toBe(false);
  });
});
