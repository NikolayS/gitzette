import { describe, expect, test } from "bun:test";
import { appliedMigrationNames } from "./applied-migrations";

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
});
