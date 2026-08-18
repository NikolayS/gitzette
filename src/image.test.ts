import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hasPublicationDimensions, webpDimensions } from "./image";

const valid = Uint8Array.from(atob("UklGRiIAAABXRUJQVlA4TBYAAAAv/8A/AAcQEf0PACjS//8U0f/U//4D"), (char) => char.charCodeAt(0));
const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("WebP validation", () => {
  test("reads real lossless WebP dimensions", () => {
    expect(webpDimensions(valid)).toEqual({ width: 256, height: 256 });
  });

  test("reads lossy VP8 and extended VP8X files produced by ImageMagick", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gitzette-webp-test-"));
    directories.push(directory);
    const lossy = join(directory, "lossy.webp");
    const extended = join(directory, "extended.webp");
    await convert(["-size", "640x480", "xc:red", "-quality", "80", lossy]);
    await convert(["-size", "321x257", "xc:none", "-fill", "blue", "-draw", "circle 160,128 220,128", extended]);
    expect(webpDimensions(new Uint8Array(await readFile(lossy)))).toEqual({ width: 640, height: 480 });
    expect(webpDimensions(new Uint8Array(await readFile(extended)))).toEqual({ width: 321, height: 257 });
  });

  test("rejects truncation and a forged RIFF length", () => {
    expect(webpDimensions(valid.slice(0, 20))).toBeNull();
    const forged = valid.slice();
    forged[4] = 0;
    expect(webpDimensions(forged)).toBeNull();
  });

  test("rejects a VP8 sync code forged outside its fixed frame-header offset", () => {
    const forged = new Uint8Array(40);
    forged.set(new TextEncoder().encode("RIFF"), 0);
    new DataView(forged.buffer).setUint32(4, forged.byteLength - 8, true);
    forged.set(new TextEncoder().encode("WEBPVP8 "), 8);
    forged.set([0x9d, 0x01, 0x2a, 0x00, 0x01, 0x00, 0x01], 30);
    expect(webpDimensions(forged)).toBeNull();
  });

  test("enforces publication dimensions", () => {
    expect(hasPublicationDimensions({ width: 256, height: 2048 })).toBe(true);
    expect(hasPublicationDimensions({ width: 1, height: 1 })).toBe(false);
    expect(hasPublicationDimensions({ width: 4096, height: 1024 })).toBe(false);
  });
});

async function convert(args: string[]): Promise<void> {
  const child = Bun.spawn(["/usr/bin/convert", ...args], { stdout: "ignore", stderr: "pipe" });
  const stderr = new Response(child.stderr).text();
  if (await child.exited !== 0) throw new Error(await stderr);
}
