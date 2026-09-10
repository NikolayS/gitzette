import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalSchema, schemasMatch } from "./schema-equivalence";

const cliPath = fileURLToPath(new URL("./schema-equivalence.ts", import.meta.url));

describe("schema equivalence", () => {
  const schema = (sql: string) => [{ results: [{ type: "table", name: "jobs", sql }] }];

  test("strict comment boundaries preserve comments and punctuation", () => {
    expect(schemasMatch(schema("CREATE TABLE jobs(id TEXT -- note\n, name TEXT)"), schema("CREATE TABLE jobs(id TEXT\n-- note\n , name TEXT)"), true)).toBe(true);
    expect(schemasMatch(schema("CREATE TABLE jobs(id /* keep */ TEXT)"), schema("CREATE TABLE jobs( id /* keep */  TEXT )"), true)).toBe(true);
    expect(schemasMatch(schema("CREATE TABLE jobs(id /* keep */ TEXT)"), schema("CREATE TABLE jobs(id /* changed */ TEXT)"), true)).toBe(false);
  });

  test("strict line comments tolerate trailing formatting whitespace", () => {
    expect(schemasMatch(schema("CREATE TABLE jobs(id TEXT -- note  \n)"), schema("CREATE TABLE jobs(id TEXT -- note\n)"), true)).toBe(true);
  });

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
    for (const strict of [false, true]) {
      expect(schemasMatch(
        schema("CREATE TABLE jobs(id TEXT DEFAULT 'a\n  b')"),
        schema("CREATE TABLE jobs(id TEXT DEFAULT 'a\nb')"),
        strict,
      )).toBe(false);
    }
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

  test("strict mode preserves authored DDL while tolerating layout around punctuation", () => {
    expect(schemasMatch(
      schema("CREATE TABLE jobs (id TEXT, state TEXT)"),
      schema("CREATE TABLE jobs(id TEXT,state TEXT)"),
      true,
    )).toBe(true);
    expect(schemasMatch(
      schema("CREATE TABLE IF NOT EXISTS jobs(id TEXT)"),
      schema("CREATE TABLE jobs(id TEXT)"),
      true,
    )).toBe(false);
    expect(schemasMatch(
      schema("CREATE TABLE jobs(id TEXT /* reviewed */)"),
      schema("CREATE TABLE jobs(id TEXT)"),
      true,
    )).toBe(false);
    expect(schemasMatch(
      schema('CREATE TABLE "jobs"(id TEXT)'),
      schema("CREATE TABLE jobs(id TEXT)"),
      true,
    )).toBe(false);
    expect(schemasMatch(
      schema("CREATE TABLE jobs(label TEXT DEFAULT 'a, b')"),
      schema("CREATE TABLE jobs(label TEXT DEFAULT 'a,b')"),
      true,
    )).toBe(false);
    expect(schemasMatch(
      schema("CREATE TABLE jobs(id TEXT, -- the user's immutable id\n state TEXT)"),
      schema("CREATE TABLE jobs(id TEXT,-- the user's immutable id\nstate TEXT)"),
      true,
    )).toBe(true);
    expect(schemasMatch(
      schema("CREATE TABLE jobs(id TEXT -- reviewed id\n,state TEXT)"),
      schema("CREATE TABLE jobs(id TEXT -- reviewed id\n)"),
      true,
    )).toBe(false);
  });

  test("CLI pins argv order, labels, strict mode, and unknown modes", async () => {
    const root = await mkdtemp(join(process.env.RUNNER_TEMP || tmpdir(), "schema-cli-"));
    try {
      const canonicalPath = join(root, "canonical.json");
      const strictPath = join(root, "strict.json");
      await Bun.write(canonicalPath, JSON.stringify(schema("CREATE TABLE IF NOT EXISTS jobs(id TEXT)")));
      await Bun.write(strictPath, JSON.stringify(schema("CREATE TABLE jobs(id TEXT)")));
      const run = async (...args: string[]) => {
        const child = Bun.spawn(["bun", cliPath, ...args], { stdout: "pipe", stderr: "pipe" });
        const [exitCode, stderr] = await Promise.all([
          child.exited,
          new Response(child.stderr).text(),
        ]);
        return { exitCode, stderr };
      };
      expect(await run(canonicalPath, canonicalPath, "same")).toEqual({ exitCode: 0, stderr: "" });
      expect(await run(canonicalPath, strictPath, "canonical")).toEqual({ exitCode: 0, stderr: "" });
      const strict = await run(canonicalPath, strictPath, "strict mismatch", "--strict");
      expect(strict.exitCode).toBe(1);
      expect(strict.stderr).toContain("strict mismatch");
      const strictWithoutLabel = await run(canonicalPath, strictPath, "--strict");
      expect(strictWithoutLabel.exitCode).toBe(1);
      expect(strictWithoutLabel.stderr).toContain("schema mismatch");
      const unknown = await run(canonicalPath, strictPath, "label", "--loose");
      expect(unknown.exitCode).toBe(1);
      expect(unknown.stderr).toContain("unknown schema comparison mode: --loose");
      expect(unknown.stderr).not.toMatch(/^\s+at /m);
      const missing = await run(join(root, "missing.json"), strictPath);
      expect(missing.exitCode).toBe(1);
      expect(missing.stderr).toContain("could not read expected schema:");
      expect(missing.stderr).not.toMatch(/^\s+at /m);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("new-object migration fails closed on a pre-existing object", async () => {
    const migration = await Bun.file("migrations/0001_generation_queue.sql").text();
    expect(migration).not.toMatch(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+IF\s+NOT\s+EXISTS/i);
  });
});
