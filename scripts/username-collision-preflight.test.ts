import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertNoUsernameCollisions } from "./username-collision-preflight";

const cliPath = fileURLToPath(new URL("./username-collision-preflight.ts", import.meta.url));

describe("production username collision preflight", () => {
  test("accepts an exact empty Wrangler result", () => {
    expect(() => assertNoUsernameCollisions([{ success: true, results: [] }])).not.toThrow();
  });

  test("fails closed on collisions and malformed envelopes", () => {
    expect(() => assertNoUsernameCollisions([
      { success: true, results: [{ username: "nik", total: 2 }] },
    ])).toThrow("production contains case-folding GitHub username collisions");
    for (const value of [[], [{ success: false, results: [] }], [{ error: "denied", results: [] }], [{}]]) {
      expect(() => assertNoUsernameCollisions(value)).toThrow(
        "invalid production username-collision preflight response",
      );
    }
  });

  test("CLI consumes argv[2] and reports read and parse failures without a stack trace", async () => {
    const root = await mkdtemp(join(process.env.RUNNER_TEMP || tmpdir(), "collision-cli-"));
    try {
      const validPath = join(root, "valid.json");
      const malformedPath = join(root, "malformed.json");
      await Bun.write(validPath, JSON.stringify([{ success: true, results: [] }]));
      await Bun.write(malformedPath, "not-json");

      const run = async (path: string) => {
        const child = Bun.spawn(["bun", cliPath, path], { stdout: "pipe", stderr: "pipe" });
        const [exitCode, stderr] = await Promise.all([
          child.exited,
          new Response(child.stderr).text(),
        ]);
        return { exitCode, stderr };
      };

      expect(await run(validPath)).toEqual({ exitCode: 0, stderr: "" });
      const malformed = await run(malformedPath);
      expect(malformed.exitCode).toBe(1);
      expect(malformed.stderr).toContain("invalid username-collision JSON:");
      expect(malformed.stderr).not.toMatch(/^\s+at /m);
      const missing = await run(join(root, "missing.json"));
      expect(missing.exitCode).toBe(1);
      expect(missing.stderr).toContain("could not read username-collision response:");
      expect(missing.stderr).not.toMatch(/^\s+at /m);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
