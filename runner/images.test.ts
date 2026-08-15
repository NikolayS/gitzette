import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { perceptualDistance, postProcessImage, sha256, validateVisual, type ImageRuntime } from "./images";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("isolated image pipeline", () => {
  test("runs against an explicitly supported ImageMagick major", async () => {
    const child = Bun.spawn(["/usr/bin/convert", "-version"], { stdout: "pipe", stderr: "pipe" });
    const output = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    expect(output).toMatch(/ImageMagick (6|7)\./);
  });

  test("normalizes PNG to bounded transparent WebP and validates visual metrics", async () => {
    const directory = await workspace();
    const input = join(directory, "input.png");
    const output = join(directory, "output.webp");
    await fixture(input, "red");
    const bytes = await postProcessImage(input, output, runtime());
    expect(bytes.length).toBeGreaterThan(1000);
    expect(await sha256(bytes)).toMatch(/^[a-f0-9]{64}$/);
    await expect(validateVisual(output, runtime())).resolves.toBeUndefined();
  });

  test("rejects decoder failure and output that is not a structurally valid WebP", async () => {
    const directory = await workspace();
    const input = join(directory, "input.png");
    const output = join(directory, "output.webp");
    await fixture(input, "red");
    const failing = runtime((() => Bun.spawn(["/usr/bin/false"], { stdin: "ignore", stdout: "ignore", stderr: "pipe" })) as typeof Bun.spawn);
    await expect(postProcessImage(input, output, failing)).rejects.toThrow("post-processing failed");

    await fixture(input, "blue");
    await writeFile(output, new Uint8Array(2000));
    const noOp = runtime((() => Bun.spawn(["/usr/bin/true"], { stdin: "ignore", stdout: "ignore", stderr: "pipe" })) as typeof Bun.spawn);
    await expect(postProcessImage(input, output, noOp)).rejects.toThrow("invalid WebP dimensions");
  });

  test("rejects opaque/flat art and detects perceptually distinct illustrations", async () => {
    const directory = await workspace();
    const flat = join(directory, "flat.webp");
    const leftPng = join(directory, "left.png");
    const rightPng = join(directory, "right.png");
    const left = join(directory, "left.webp");
    const right = join(directory, "right.webp");
    await command(["/usr/bin/convert", "-size", "1024x1024", "xc:white", flat]);
    await expect(validateVisual(flat, runtime())).rejects.toThrow("alpha coverage");
    await fixture(leftPng, "red");
    await fixture(rightPng, "blue");
    await postProcessImage(leftPng, left, runtime());
    await postProcessImage(rightPng, right, runtime());
    expect(await perceptualDistance(left, right, runtime())).toBeGreaterThan(0.08);
  });
});

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "gitzette-images-test-"));
  directories.push(directory);
  return directory;
}

async function fixture(path: string, color: string): Promise<void> {
  await command(["/usr/bin/convert", "-size", "1024x1024", "xc:#f7f4ee", "-fill", color, "-draw", "circle 512,512 760,512", path]);
}

async function command(argv: string[]): Promise<void> {
  const child = Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "pipe" });
  const stderr = new Response(child.stderr).text();
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(await stderr);
}

function runtime(spawn: typeof Bun.spawn = Bun.spawn): ImageRuntime {
  return { spawn, convertBin: "/usr/bin/convert", compareBin: "/usr/bin/compare", policyDir: `${import.meta.dir}/imagemagick` };
}
