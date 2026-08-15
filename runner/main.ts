import { chmod, mkdir, stat } from "node:fs/promises";
import { loadConfig } from "./config";
import { ControlPlaneClient } from "./control-plane";
import { GitHubCollector } from "./github";
import { OpenClawInference } from "./inference";
import { RunnerEngine } from "./run";

const config = loadConfig();
await ensurePrivateDirectory(config.workDir);
await ensurePrivateDirectory(`${config.openclawHome}/tmp`);

const engine = new RunnerEngine(
  config,
  new ControlPlaneClient(config.controlPlaneOrigin, config.runnerSecret),
  new GitHubCollector(config.githubToken),
  new OpenClawInference(config),
);

let stopping = false;
let consecutiveFailures = 0;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

while (!stopping) {
  try {
    const result = await engine.runOnce();
    if (result !== "idle") console.log(JSON.stringify({ at: new Date().toISOString(), result }));
    consecutiveFailures = result === "failed" ? consecutiveFailures + 1 : 0;
  } catch (error) {
    consecutiveFailures += 1;
    console.error(JSON.stringify({ at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }));
  }
  // Fail closed under provider throttling or broad outages. Repeated failures
  // exponentially pause claims, capped at 15 minutes, instead of rapidly
  // consuming every queued attempt and the shared OAuth account's capacity.
  const delaySeconds = consecutiveFailures === 0
    ? config.pollSeconds
    : Math.min(15 * 60, config.pollSeconds * 2 ** Math.min(consecutiveFailures, 10));
  if (!stopping) await Bun.sleep(delaySeconds * 1000);
}

async function ensurePrivateDirectory(path: string): Promise<void> {
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
