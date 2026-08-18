import { describe, expect, test } from "bun:test";
import { isOAuthAuthFailure } from "./auth-failure";
import { OpenClawInference, OpenClawInferenceError } from "./inference";
import type { RunnerConfig } from "./config";

describe("OAuth auth failure classification", () => {
  test("classifies a real OpenClaw failure through the typed producer contract", async () => {
    const spawn = (() => Bun.spawn([
      "/usr/bin/python3", "-c",
      "import sys; sys.stderr.write('OAuth session expired'); sys.exit(1)",
    ], { stdin: "ignore", stdout: "pipe", stderr: "pipe" })) as typeof Bun.spawn;
    let failure: unknown;
    try {
      await new OpenClawInference(config(), spawn).write({
        state: "quiet", username: "octocat", weekKey: "2026-W32", items: [],
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(OpenClawInferenceError);
    expect(isOAuthAuthFailure(failure)).toBe(true);
  });

  test("does not treat numeric data, quota, overload, or unrelated errors as auth failures", () => {
    expect(isOAuthAuthFailure(new OpenClawInferenceError(1, "HTTP 401 unauthorized"))).toBe(true);
    expect(isOAuthAuthFailure(new OpenClawInferenceError(1, "status code: 403"))).toBe(true);
    expect(isOAuthAuthFailure(new OpenClawInferenceError(1, "model emitted 401 tokens in 403 ms"))).toBe(false);
    expect(isOAuthAuthFailure(new OpenClawInferenceError(1, "session limit reached"))).toBe(false);
    expect(isOAuthAuthFailure(new OpenClawInferenceError(1, "HTTP 529 overloaded"))).toBe(false);
    expect(isOAuthAuthFailure(new Error("OAuth session expired"))).toBe(false);
  });
});

function config(): RunnerConfig {
  return {
    controlPlaneOrigin: "https://gitzette.online", runnerSecret: "x", githubToken: "x",
    openclawBin: "/sealed/openclaw", openclawHome: "/tmp", pollSeconds: 10, heartbeatSeconds: 60,
    workDir: "/tmp", generatorVersion: "test", imageMagickBin: "/usr/bin/convert",
    imageMagickCompareBin: "/usr/bin/compare",
  };
}
