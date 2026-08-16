import { loadConfig } from "./config";
import { ControlPlaneClient } from "./control-plane";
import { GitHubCollector } from "./github";
import { OpenClawInference } from "./inference";
import { RunnerEngine } from "./run";
import { ensurePrivateDirectory } from "./fs";
import { failureBackoffSeconds } from "./backoff";

const config = loadConfig();
await ensurePrivateDirectory(config.openclawHome);
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
let wakeForStop!: () => void;
const stoppingSignal = new Promise<void>((resolve) => { wakeForStop = resolve; });
const stop = () => {
  stopping = true;
  wakeForStop();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

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
  const delaySeconds = failureBackoffSeconds(consecutiveFailures, config.pollSeconds);
  if (!stopping) await Promise.race([Bun.sleep(delaySeconds * 1000), stoppingSignal]);
}
