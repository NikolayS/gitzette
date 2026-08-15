import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensurePrivateDirectory } from "./fs";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("runner private directories", () => {
  test("creates a private directory and tightens an existing permissive one", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitzette-runner-fs-"));
    roots.push(root);
    const path = join(root, "work");
    await ensurePrivateDirectory(path);
    expect((await stat(path)).mode & 0o777).toBe(0o700);
    await chmod(path, 0o755);
    await ensurePrivateDirectory(path);
    expect((await stat(path)).mode & 0o777).toBe(0o700);
  });

  test("rejects a symlinked private directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitzette-runner-fs-"));
    roots.push(root);
    const target = join(root, "target");
    const path = join(root, "work");
    await ensurePrivateDirectory(target);
    await symlink(target, path);
    await expect(ensurePrivateDirectory(path)).rejects.toThrow("is unsafe");
  });
});
