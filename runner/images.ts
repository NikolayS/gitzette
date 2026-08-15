import { lstat, mkdir, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { hasPublicationDimensions, webpDimensions } from "../src/image";

type SpawnFn = typeof Bun.spawn;
export type ImageRuntime = { spawn: SpawnFn; convertBin: string; compareBin: string; policyDir: string };

export async function postProcessImage(input: string, output: string, runtime = defaultRuntime()): Promise<Uint8Array> {
  const source = await lstat(input);
  // lstat + isFile rejects symlinks, including links to otherwise regular files.
  if (!source.isFile() || source.size < 1000 || source.size > 20 * 1024 * 1024) {
    throw new Error("input image is not a bounded regular file");
  }
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  const child = runtime.spawn([
    runtime.convertBin,
    "-limit", "memory", "256MiB", "-limit", "map", "512MiB", "-limit", "disk", "1GiB", "-limit", "time", "120",
    `png:${input}`,
    "-fuzz", "10%", "-transparent", "#f7f4ee",
    "-trim", "+repage", "-resize", "896x896>",
    "-gravity", "center", "-background", "none", "-extent", "1024x1024",
    "-strip", "-quality", "82", `webp:${output}`,
  ], { stdin: "ignore", stdout: "ignore", stderr: "pipe", env: imageEnv(runtime) });
  const stderr = new Response(child.stderr).text();
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`image post-processing failed: ${(await stderr).slice(-500)}`);
  const bytes = new Uint8Array(await readFile(output));
  if (bytes.byteLength > 5 * 1024 * 1024) throw new Error("processed image exceeds 5 MiB");
  const dimensions = webpDimensions(bytes);
  if (!dimensions || !hasPublicationDimensions(dimensions) || dimensions.width !== 1024 || dimensions.height !== 1024) {
    throw new Error("processed image has invalid WebP dimensions");
  }
  await rm(input, { force: true });
  return bytes;
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

export async function validateVisual(path: string, runtime = defaultRuntime()): Promise<void> {
  const alpha = await metric([`webp:${path}`, "-alpha", "extract", "-format", "%[fx:mean]", "info:"], runtime);
  if (alpha < 0.04 || alpha > 0.92) throw new Error(`invalid illustration alpha coverage: ${alpha}`);
  const contrast = await metric([`webp:${path}`, "-background", "white", "-alpha", "background", "-alpha", "off", "-colorspace", "Gray", "-format", "%[fx:standard_deviation]", "info:"], runtime);
  if (contrast < 0.05) throw new Error(`illustration contrast too low: ${contrast}`);
}

export async function perceptualDistance(left: string, right: string, runtime = defaultRuntime()): Promise<number> {
  const child = runtime.spawn([runtime.compareBin, "-metric", "RMSE", `webp:${left}`, `webp:${right}`, "null:"], {
    stdin: "ignore", stdout: "ignore", stderr: "pipe", env: imageEnv(runtime),
  });
  const stderr = new Response(child.stderr).text();
  const exitCode = await child.exited;
  if (exitCode !== 0 && exitCode !== 1) throw new Error(`image comparison failed: ${(await stderr).slice(-300)}`);
  const match = /\(([0-9.]+)\)/.exec(await stderr);
  if (!match) throw new Error("image comparison returned no normalized distance");
  return Number(match[1]);
}

async function metric(args: string[], runtime: ImageRuntime): Promise<number> {
  const child = runtime.spawn([runtime.convertBin, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: imageEnv(runtime) });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new Error(`image metric failed: ${stderr.slice(-300)}`);
  const value = Number(stdout.trim());
  if (!Number.isFinite(value)) throw new Error("image metric was not numeric");
  return value;
}

export function defaultRuntime(): ImageRuntime {
  return {
    spawn: Bun.spawn,
    convertBin: process.env.GITZETTE_IMAGEMAGICK_BIN ?? "/usr/bin/convert",
    compareBin: process.env.GITZETTE_IMAGEMAGICK_COMPARE_BIN ?? "/usr/bin/compare",
    policyDir: process.env.GITZETTE_IMAGEMAGICK_POLICY_DIR ?? `${import.meta.dir}/imagemagick`,
  };
}

function imageEnv(runtime: ImageRuntime): Record<string, string> {
  return { PATH: "/usr/bin:/bin", MAGICK_CONFIGURE_PATH: runtime.policyDir };
}
