import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appliedMigrationNames, appliedMigrationsFromDirectory } from "./applied-migrations";

const committed = ["0000_base.sql", "0001_generation_jobs.sql", "0002_future.sql"];

describe("applied migration replay boundary", () => {
  test("accepts only an ordered prefix of the reviewed migration chain", () => {
    expect(appliedMigrationNames(committed, [{ results: [
      { name: "0000_base.sql" },
      { name: "0001_generation_jobs.sql" },
    ] }])).toEqual(["0000_base.sql", "0001_generation_jobs.sql"]);
  });

  test("rejects empty, unknown, reordered, and duplicate ledger entries", () => {
    expect(() => appliedMigrationNames(committed, [{ results: [] }])).toThrow("empty or invalid");
    expect(() => appliedMigrationNames(committed, [{ results: [{ name: "9999_unknown.sql" }] }])).toThrow("not a prefix");
    expect(() => appliedMigrationNames(committed, [{ results: [{ name: "0001_generation_jobs.sql" }] }])).toThrow("not a prefix");
    expect(() => appliedMigrationNames(committed, [{ results: [{ name: "0000_base.sql" }, { name: "0000_base.sql" }] }])).toThrow("duplicate");
  });

  test("reads the migration directory and distinguishes disk-ahead from ledger-ahead", () => {
    const directory = mkdtempSync(join(tmpdir(), "gitzette-migrations-test-"));
    try {
      writeFileSync(join(directory, "0000_base.sql"), "select 1;");
      writeFileSync(join(directory, "0001_queue.sql"), "select 1;");
      writeFileSync(join(directory, "README.md"), "ignored");
      expect(appliedMigrationsFromDirectory(directory, [{ results: [{ name: "0000_base.sql" }] }]))
        .toEqual(["0000_base.sql"]);
      expect(() => appliedMigrationsFromDirectory(directory, [{ results: [
        { name: "0000_base.sql" },
        { name: "0001_queue.sql" },
        { name: "0002_missing.sql" },
      ] }])).toThrow("not a prefix");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("pins the reviewed migration filenames on disk", () => {
    expect(readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()).toEqual([
      "0000_base.sql",
      "0001_generation_queue.sql",
      "0002_weekly_generation_schedule.sql",
      "0003_remove_legacy_generating_dispatch.sql",
      "0004_normalize_github_usernames.sql",
      "0005_profile_suppressions.sql",
    ]);
  });
});
