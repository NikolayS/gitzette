import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RunnerConfig } from "./config";
import { OpenClawInference } from "./inference";

describe("OpenClaw CLI boundary", () => {
  test("uses an argv array, verifies the image envelope, and strips secrets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gitzette-cli-test-"));
    const output = join(directory, "image.png");
    await writeFile(output, new Uint8Array(2000));
    let originalArgv: string[] = [];
    let originalEnv: Record<string, string | undefined> = {};
    const spawn = ((argv: string[], options: Bun.SpawnOptions.OptionsObject<"ignore", "pipe", "pipe">) => {
      originalArgv = argv;
      originalEnv = options.env ?? {};
      return Bun.spawn([
        "/usr/bin/printf",
        "%s",
        JSON.stringify({ ok: true, provider: "openai", model: "gpt-image-2" }),
      ], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    }) as typeof Bun.spawn;

    const usage = await new OpenClawInference(config(directory), spawn).illustrate("hostile $(touch /tmp/nope)", output);
    expect(originalArgv[0]).toBe("/sealed/openclaw");
    expect(originalArgv.slice(1, 5)).toEqual(["infer", "image", "generate", "--json"]);
    expect(originalArgv).not.toContain("sh");
    expect(originalEnv.GITZETTE_RUNNER_SECRET).toBeUndefined();
    expect(originalEnv.GITZETTE_GITHUB_TOKEN).toBeUndefined();
    expect(originalEnv.OPENAI_API_KEY).toBeUndefined();
    expect(usage.tokenSource).toBe("estimated");
    expect(usage.inputTokens).toBeGreaterThan(0);
  });

  test("fails closed when the image CLI omits its provenance envelope", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gitzette-cli-test-"));
    const spawn = (() => Bun.spawn(["/usr/bin/true"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })) as typeof Bun.spawn;

    await expect(new OpenClawInference(config(directory), spawn).illustrate("subject", join(directory, "image.png")))
      .rejects.toThrow("image generator returned no provenance envelope");
  });
});

function config(directory: string): RunnerConfig {
  return {
    controlPlaneOrigin: "https://gitzette.online",
    runnerSecret: "must-not-reach-model",
    githubToken: "must-not-reach-model",
    openclawBin: "/sealed/openclaw",
    openclawHome: directory,
    pollSeconds: 10,
    heartbeatSeconds: 60,
    workDir: directory,
    generatorVersion: "test",
    imageMagickBin: "/usr/bin/convert",
    imageMagickCompareBin: "/usr/bin/compare",
  };
}
