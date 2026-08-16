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

  test("strips SQL comments without losing structural drift or doubled quotes", () => {
    expect(schemasMatch(
      schema("CREATE TABLE jobs(id TEXT /* user's immutable id */,state TEXT DEFAULT 'it''s ready')"),
      schema("CREATE TABLE jobs(id TEXT,state TEXT DEFAULT 'it''s ready')"),
    )).toBe(true);
    expect(schemasMatch(
      schema("CREATE TABLE jobs(id TEXT -- user's immutable id\n,state TEXT)"),
      schema("CREATE TABLE jobs(id TEXT -- user's immutable id\n)"),
    )).toBe(false);
    expect(schemasMatch(
      schema('CREATE TABLE jobs("id""quoted" TEXT,state TEXT)'),
      schema('CREATE TABLE jobs("id""quoted" TEXT)'),
    )).toBe(false);
  });

  test("new-object migration fails closed on a pre-existing object", async () => {
    const migration = await Bun.file("migrations/0001_generation_queue.sql").text();
    expect(migration).not.toMatch(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+IF\s+NOT\s+EXISTS/i);
  });
});
