import { describe, expect, test } from "bun:test";
import { inferenceEnv, loadConfig } from "./config";

const base = {
  GITZETTE_CONTROL_PLANE_ORIGIN: "https://gitzette.online",
  GITZETTE_RUNNER_SECRET: "runner-secret",
  GITZETTE_GITHUB_TOKEN: "github-token",
  GITZETTE_GENERATOR_VERSION: "test-commit",
};

describe("runner configuration boundary", () => {
  test("accepts an HTTPS origin and emits a secret-free inference environment", () => {
    const config = loadConfig(base);
    expect(config.controlPlaneOrigin).toBe("https://gitzette.online");
    const env = inferenceEnv(config);
    expect(env.GITZETTE_RUNNER_SECRET).toBeUndefined();
    expect(env.GITZETTE_GITHUB_TOKEN).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(Object.keys(env).sort()).toEqual(["HOME", "OPENCLAW_CONFIG_PATH", "OPENCLAW_STATE_DIR", "PATH", "TMPDIR", "XDG_CACHE_HOME", "XDG_CONFIG_HOME"]);
  });

  test("rejects AI API keys and non-origin control-plane values", () => {
    expect(() => loadConfig({ ...base, OPENAI_API_KEY: "forbidden" })).toThrow("OAuth-only");
    expect(() => loadConfig({ ...base, GITZETTE_CONTROL_PLANE_ORIGIN: "https://gitzette.online/runner" })).toThrow("origin only");
    expect(() => loadConfig({ ...base, GITZETTE_CONTROL_PLANE_ORIGIN: "http://evil.example" })).toThrow("HTTPS");
  });
});
