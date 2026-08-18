import { loadConfig } from "./config";
import { ControlPlaneClient } from "./control-plane";
import { GitHubCollector } from "./github";
import { OpenClawInference } from "./inference";
import { RunnerEngine, type RunnerResult } from "./run";
import { ensurePrivateDirectory } from "./fs";
import { failureBackoffSeconds } from "./backoff";

type LoopEngine = { runOnce(): Promise<RunnerResult> };

export const AUTH_FAILURE_ALERT_THRESHOLD = 3;

type LoopControls = {
  isStopping(): boolean;
  sleep(milliseconds: number): Promise<void>;
  log(message: string): void;
  logError(message: string): void;
};

export async function runPollLoop(engine: LoopEngine, pollSeconds: number, controls: LoopControls): Promise<void> {
  let consecutiveFailures = 0;
  let consecutiveAuthFailures = 0;
  while (!controls.isStopping()) {
    try {
      const result = await engine.runOnce();
      if (result !== "idle") controls.log(JSON.stringify({ at: new Date().toISOString(), result }));
      consecutiveFailures = result === "failed" || result === "auth_failed" ? consecutiveFailures + 1 : 0;
      consecutiveAuthFailures = result === "auth_failed" ? consecutiveAuthFailures + 1 : 0;
      if (consecutiveAuthFailures === AUTH_FAILURE_ALERT_THRESHOLD) {
        controls.logError(JSON.stringify({
          at: new Date().toISOString(),
          event: "oauth_auth_failure_alert",
          consecutiveAuthFailures,
          action: "disable runner and restore the dedicated OAuth session",
        }));
      }
    } catch (error) {
      consecutiveFailures += 1;
      consecutiveAuthFailures = 0;
      controls.logError(JSON.stringify({ at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }));
    }
    // Fail closed under provider throttling or broad outages. Repeated failures
    // exponentially pause claims, capped at 15 minutes, instead of rapidly
    // consuming every queued attempt and the shared OAuth account's capacity.
    const delaySeconds = failureBackoffSeconds(consecutiveFailures, pollSeconds);
    if (!controls.isStopping()) await controls.sleep(delaySeconds * 1000);
  }
}

async function main(): Promise<void> {
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
  let wakeForStop!: () => void;
  const stoppingSignal = new Promise<void>((resolve) => { wakeForStop = resolve; });
  const stop = () => {
    stopping = true;
    wakeForStop();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  await runPollLoop(engine, config.pollSeconds, {
    isStopping: () => stopping,
    sleep: (milliseconds) => Promise.race([Bun.sleep(milliseconds), stoppingSignal]),
    log: console.log,
    logError: console.error,
  });
}

if (import.meta.main) await main();
