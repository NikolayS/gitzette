import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

test("preflights distinguish policy failures from malformed input", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gitzette-preflight-"));
  try {
    for (const [script, input, expected] of [
      ["check-production-collisions.cjs", JSON.stringify([{ results: [{ username: "duplicate", total: 2 }] }]), "collisions"],
      ["check-production-secrets.cjs", "[]", "production Worker secret mismatch"],
      ["check-production-secrets.cjs", "not-json", "invalid input document"],
      ["check-production-collisions.cjs", "not-json", "invalid input document"],
      ["check-production-collisions.cjs", '[]', "invalid production username-collision preflight response"],
      ["check-production-collisions.cjs", '[{"error":"unauthorized"}]', "invalid production username-collision preflight response"],
      ["check-production-collisions.cjs", '[{"success":false}]', "invalid production username-collision preflight response"],

    ]) {
      const file = join(dir, "input with spaces.json");
      await writeFile(file, input);
      const child = Bun.spawn([process.execPath, fileURLToPath(new URL(script, import.meta.url)), file], { stdout: "pipe", stderr: "pipe" });
      const stderr = await new Response(child.stderr).text();
      expect(await child.exited).toBe(1);
      expect(stderr).toContain(expected);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("schema preflights compare two independent paths and reject malformed input", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gitzette-schema-"));
  try {
    const left = join(dir, "left schema.json");
    const right = join(dir, "right schema.json");
    const schema = (column: string) => JSON.stringify([{ results: [{ type: "table", name: "example", sql: `CREATE TABLE example (${column} TEXT)` }] }]);
    await writeFile(left, schema("original"));
    for (const script of ["compare-production-baseline.cjs", "compare-production-drift.cjs"]) {
      for (const [content, exit] of [[schema("original"), 0], [schema("different"), 1], ["not-json", 1], ["[]", 1], ['[{"error":"unauthorized"}]', 1], ['[{"success":false,"results":[]}]', 1]] as const) {
        await writeFile(right, content);
        const child = Bun.spawn([process.execPath, fileURLToPath(new URL(script, import.meta.url)), left, right], { stdout: "pipe", stderr: "pipe" });
        const stderr = await new Response(child.stderr).text();
        expect(await child.exited).toBe(exit);
        if (content === "not-json" || content === "[]" || content.includes("unauthorized") || content.includes('"success":false')) expect(stderr).toMatch(/invalid input document|invalid Wrangler schema result/);
        else if (exit === 1) expect(stderr).toMatch(/differs|drifted/);
      }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test("production comparers preserve quoted SQL values and report file errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gitzette-quoted-schema-"));
  try {
    const left = join(dir, "left.json"), right = join(dir, "right.json");
    const schema = (value: string) => JSON.stringify([{ results: [{ type: "table", name: "t", sql: `CREATE TABLE t (v TEXT DEFAULT '${value}')` }] }]);
    for (const script of ["compare-production-baseline.cjs", "compare-production-drift.cjs"]) {
      for (const [a, b] of [["a, b", "a,b"], ["a  b", "a b"], ["CREATE TABLE IF NOT EXISTS", "CREATE TABLE"]]) {
        await writeFile(left, schema(a)); await writeFile(right, schema(b));
        const child = Bun.spawn([process.execPath, fileURLToPath(new URL(script, import.meta.url)), left, right], { stdout: "pipe", stderr: "pipe" });
        expect(await child.exited).toBe(1);
        expect(await new Response(child.stderr).text()).toMatch(/differs|drifted/);
      }
      const child = Bun.spawn([process.execPath, fileURLToPath(new URL(script, import.meta.url)), join(dir, "missing.json"), right], { stdout: "pipe", stderr: "pipe" });
      expect(await child.exited).toBe(1);
      expect(await new Response(child.stderr).text()).toContain("ENOENT");
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
