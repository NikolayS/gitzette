import { mkdir } from "node:fs/promises";
import { loadConfig } from "./config";
import { ControlPlaneClient } from "./control-plane";
import { GitHubCollector } from "./github";
import { OpenClawInference } from "./inference";
import { RunnerEngine } from "./run";

const config = loadConfig();
await mkdir(config.workDir, { recursive: true, mode: 0o700 });
await mkdir(`${config.openclawHome}/tmp`, { recursive: true, mode: 0o700 });

const engine = new RunnerEngine(
  config,
  new ControlPlaneClient(config.controlPlaneOrigin, config.runnerSecret),
  new GitHubCollector(config.githubToken),
  new OpenClawInference(config),
);

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

while (!stopping) {
  try {
    const result = await engine.runOnce();
    if (result !== "idle") console.log(JSON.stringify({ at: new Date().toISOString(), result }));
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }));
  }
  if (!stopping) await Bun.sleep(config.pollSeconds * 1000);
}
