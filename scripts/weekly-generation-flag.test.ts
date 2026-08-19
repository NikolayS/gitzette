import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { weeklyGenerationEnabled } from "./weekly-generation-flag";

const cliPath = fileURLToPath(new URL("./weekly-generation-flag.ts", import.meta.url));

describe("weekly generation activation flag", () => {
  test("accepts only explicit string booleans", () => {
    expect(weeklyGenerationEnabled('[vars]\nWEEKLY_GENERATION_ENABLED = "true"')).toBe(true);
    expect(weeklyGenerationEnabled('[vars]\nWEEKLY_GENERATION_ENABLED = "false"')).toBe(false);
    expect(() => weeklyGenerationEnabled("[vars]")).toThrow("invalid WEEKLY_GENERATION_ENABLED");
    expect(() => weeklyGenerationEnabled("[vars]\nWEEKLY_GENERATION_ENABLED = true")).toThrow(
      "invalid WEEKLY_GENERATION_ENABLED",
    );
  });

  test("CLI consumes argv[2] and reports missing input without a stack trace", async () => {
    const run = async (...args: string[]) => {
      const child = Bun.spawn(["bun", cliPath, ...args], { stdout: "pipe", stderr: "pipe" });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { exitCode, stdout, stderr };
    };
    const root = await mkdtemp(join(process.env.RUNNER_TEMP || tmpdir(), "weekly-flag-cli-"));
    try {
      const fixture = join(root, "wrangler.toml");
      await Bun.write(fixture, '[vars]\nWEEKLY_GENERATION_ENABLED = "false"\n');
      expect(await run(fixture)).toEqual({ exitCode: 0, stdout: "false", stderr: "" });
      const missingArgument = await run();
      expect(missingArgument.exitCode).toBe(1);
      expect(missingArgument.stderr).toContain("usage: bun scripts/weekly-generation-flag.ts");
      expect(missingArgument.stderr).not.toMatch(/^\s+at /m);
      const missingFile = await run("missing-wrangler.toml");
      expect(missingFile.exitCode).toBe(1);
      expect(missingFile.stderr).toContain("could not read weekly generation config:");
      expect(missingFile.stderr).not.toMatch(/^\s+at /m);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
