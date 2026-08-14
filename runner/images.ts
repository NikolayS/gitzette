import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { hasPublicationDimensions, webpDimensions } from "../src/image";

type SpawnFn = typeof Bun.spawn;

export async function postProcessImage(input: string, output: string, spawn: SpawnFn = Bun.spawn): Promise<Uint8Array> {
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  const child = spawn([
    "/usr/bin/convert", input,
    "-fuzz", "10%", "-transparent", "#f7f4ee",
    "-trim", "+repage", "-resize", "896x896>",
    "-gravity", "center", "-background", "none", "-extent", "1024x1024",
    "-strip", "-quality", "82", output,
  ], { stdin: "ignore", stdout: "ignore", stderr: "pipe", env: { PATH: "/usr/bin:/bin" } });
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

export async function validateVisual(path: string, spawn: SpawnFn = Bun.spawn): Promise<void> {
  const alpha = await metric([path, "-alpha", "extract", "-format", "%[fx:mean]", "info:"], spawn);
  if (alpha < 0.04 || alpha > 0.92) throw new Error(`invalid illustration alpha coverage: ${alpha}`);
  const contrast = await metric([path, "-background", "white", "-alpha", "background", "-alpha", "off", "-colorspace", "Gray", "-format", "%[fx:standard_deviation]", "info:"], spawn);
  if (contrast < 0.05) throw new Error(`illustration contrast too low: ${contrast}`);
}

export async function perceptualDistance(left: string, right: string, spawn: SpawnFn = Bun.spawn): Promise<number> {
  const child = spawn(["/usr/bin/compare", "-metric", "RMSE", left, right, "null:"], {
    stdin: "ignore", stdout: "ignore", stderr: "pipe", env: { PATH: "/usr/bin:/bin" },
  });
  const stderr = new Response(child.stderr).text();
  const exitCode = await child.exited;
  if (exitCode !== 0 && exitCode !== 1) throw new Error(`image comparison failed: ${(await stderr).slice(-300)}`);
  const match = /\(([0-9.]+)\)/.exec(await stderr);
  if (!match) throw new Error("image comparison returned no normalized distance");
  return Number(match[1]);
}

async function metric(args: string[], spawn: SpawnFn): Promise<number> {
  const child = spawn(["/usr/bin/convert", ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { PATH: "/usr/bin:/bin" } });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new Error(`image metric failed: ${stderr.slice(-300)}`);
  const value = Number(stdout.trim());
  if (!Number.isFinite(value)) throw new Error("image metric was not numeric");
  return value;
}
