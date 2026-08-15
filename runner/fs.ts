import { chmod, mkdir, stat } from "node:fs/promises";

export async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
  const info = await stat(path);
  if (!info.isDirectory() || (info.mode & 0o777) !== 0o700) {
    throw new Error(`runner private directory has unsafe mode: ${path}`);
  }
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
    throw new Error(`runner private directory has wrong owner: ${path}`);
  }
}
