import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("preflights distinguish policy failures from malformed input", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gitzette-preflight-"));
  try {
    for (const [script, input, expected] of [
      ["check-production-collisions.cjs", JSON.stringify([{ results: [{ username: "duplicate", total: 2 }] }]), "collisions"],
      ["check-production-secrets.cjs", "[]", "production Worker secret mismatch"],
      ["check-production-secrets.cjs", "not-json", "invalid input document"],
    ]) {
      const file = join(dir, "input with spaces.json");
      await writeFile(file, input);
      const process = Bun.spawn([Bun.which("bun")!, new URL(script, import.meta.url).pathname, file], { stdout: "pipe", stderr: "pipe" });
      const stderr = await new Response(process.stderr).text();
      expect(await process.exited).toBe(1);
      expect(stderr).toContain(expected);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
