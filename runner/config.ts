import { existsSync } from "node:fs";

export type RunnerConfig = {
  controlPlaneOrigin: string;
  runnerSecret: string;
  githubToken: string;
  openclawBin: string;
  openclawHome: string;
  pollSeconds: number;
  workDir: string;
  generatorVersion: string;
  imageMagickBin: string;
  imageMagickCompareBin: string;
  imageMagickPolicyDir: string;
};

const FORBIDDEN_AI_ENV = /(?:API_KEY|AUTH_TOKEN|_BASE_URL|_API_BASE|GOOGLE_APPLICATION_CREDENTIALS|AZURE_OPENAI_ENDPOINT)$/;

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): RunnerConfig {
  for (const [key, value] of Object.entries(env)) {
    if (value && FORBIDDEN_AI_ENV.test(key)) throw new Error(`${key} is forbidden; GitZette AI auth must be OAuth-only`);
  }

  const rawOrigin = required(env, "GITZETTE_CONTROL_PLANE_ORIGIN");
  const origin = new URL(rawOrigin);
  const allowLocal = env.GITZETTE_ALLOW_INSECURE_LOCALHOST === "1";
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") {
    throw new Error("GITZETTE_CONTROL_PLANE_ORIGIN must be an origin only");
  }
  if (origin.protocol !== "https:" && !(allowLocal && origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname))) {
    throw new Error("GITZETTE_CONTROL_PLANE_ORIGIN must use HTTPS");
  }

  const pollSeconds = Number(env.GITZETTE_POLL_SECONDS ?? "10");
  if (!Number.isInteger(pollSeconds) || pollSeconds < 2 || pollSeconds > 300) throw new Error("invalid GITZETTE_POLL_SECONDS");

  const imageMagickBin = env.GITZETTE_IMAGEMAGICK_BIN ?? "/usr/bin/convert";
  const imageMagickCompareBin = env.GITZETTE_IMAGEMAGICK_COMPARE_BIN ?? "/usr/bin/compare";
  const imageMagickPolicyDir = env.GITZETTE_IMAGEMAGICK_POLICY_DIR ?? "/opt/gitzette-runner/runner/imagemagick";
  if (!existsSync(imageMagickBin) || !existsSync(imageMagickCompareBin)) throw new Error("ImageMagick runtime is missing");
  if (!existsSync(imageMagickPolicyDir)) throw new Error("ImageMagick policy directory is missing");

  return {
    controlPlaneOrigin: origin.origin,
    runnerSecret: required(env, "GITZETTE_RUNNER_SECRET"),
    githubToken: required(env, "GITZETTE_GITHUB_TOKEN"),
    openclawBin: env.GITZETTE_OPENCLAW_BIN ?? "/var/lib/gitzette-runner/.bun/bin/openclaw",
    openclawHome: env.GITZETTE_OPENCLAW_HOME ?? "/var/lib/gitzette-runner",
    pollSeconds,
    workDir: env.GITZETTE_WORK_DIR ?? "/var/lib/gitzette-runner/work",
    generatorVersion: required(env, "GITZETTE_GENERATOR_VERSION"),
    imageMagickBin,
    imageMagickCompareBin,
    imageMagickPolicyDir,
  };
}

export function inferenceEnv(config: RunnerConfig): Record<string, string> {
  return {
    HOME: config.openclawHome,
    PATH: "/usr/local/bin:/usr/bin:/bin",
    TMPDIR: `${config.openclawHome}/tmp`,
    XDG_CONFIG_HOME: `${config.openclawHome}/.config`,
    XDG_CACHE_HOME: `${config.openclawHome}/.cache`,
    OPENCLAW_STATE_DIR: `${config.openclawHome}/.openclaw`,
    OPENCLAW_CONFIG_PATH: `${config.openclawHome}/.openclaw/openclaw.json`,
  };
}
