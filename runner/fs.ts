import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";

export async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  let directory;
  try {
    directory = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  } catch (error) {
    throw new Error(`runner private directory is unsafe: ${path}`, { cause: error });
  }
  try {
    await directory.chmod(0o700);
    const info = await directory.stat();
    if (!info.isDirectory() || (info.mode & 0o777) !== 0o700) {
      throw new Error(`runner private directory has unsafe mode: ${path}`);
    }
    if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
      throw new Error(`runner private directory has wrong owner: ${path}`);
    }
  } finally {
    await directory.close();
  }
}
