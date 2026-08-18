import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RunnerConfig } from "./config";
import { OpenClawInference } from "./inference";
import type { EvidenceBundle } from "../src/edition";

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

  test("bounds a 500-item editor prompt below the Linux argv limit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gitzette-cli-test-"));
    let prompt = "";
    const output = {
      headline: "Bounded activity",
      tagline: "The newest evidence fits.",
      closingNote: "The older tail stays in the archive.",
      stories: [
        { headline: "First", deck: "First deck", paragraphs: ["First body"], evidenceIds: ["commit:0"], tag: "FEATURE", illustrationKey: "image-1.webp" },
        { headline: "Second", deck: "Second deck", paragraphs: ["Second body"], evidenceIds: ["commit:0"], tag: "COMMUNITY", illustrationKey: "image-2.webp" },
      ],
    };
    const spawn = ((argv: string[]) => {
      prompt = argv[argv.indexOf("--prompt") + 1];
      return Bun.spawn([
        "/usr/bin/printf",
        "%s",
        JSON.stringify({ ok: true, provider: "openai", model: "gpt-5.6-sol", outputs: [{ text: JSON.stringify(output) }] }),
      ], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    }) as typeof Bun.spawn;
    const evidence: EvidenceBundle = {
      state: "active",
      username: "octocat",
      weekKey: "2026-W32",
      items: Array.from({ length: 500 }, (_, index) => ({
        id: `commit:${index}`,
        type: "commit" as const,
        title: `Change ${index} ${"x".repeat(480)}`,
        url: `https://github.com/octocat/widget/commit/${index}`,
        repo: `octocat/${"r".repeat(190)}`,
      })),
    };

    await new OpenClawInference(config(directory), spawn).write(evidence);
    expect(new TextEncoder().encode(prompt).byteLength).toBeLessThan(70 * 1024);
    expect(prompt).toContain('"id":"commit:0"');
    expect(prompt).not.toContain('"id":"commit:499"');
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
