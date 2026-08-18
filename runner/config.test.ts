import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

    const originalOpenAiKey = process.env.OPENAI_KEY;
    const originalHfToken = process.env.HF_TOKEN;
    try {
      process.env.OPENAI_KEY = "parent-secret";
      process.env.HF_TOKEN = "parent-secret";
      const isolated = inferenceEnv(config);
      expect(isolated.OPENAI_KEY).toBeUndefined();
      expect(isolated.HF_TOKEN).toBeUndefined();
    } finally {
      if (originalOpenAiKey === undefined) delete process.env.OPENAI_KEY;
      else process.env.OPENAI_KEY = originalOpenAiKey;
      if (originalHfToken === undefined) delete process.env.HF_TOKEN;
      else process.env.HF_TOKEN = originalHfToken;
    }
  });

  test("rejects AI API keys and non-origin control-plane values", () => {
    expect(() => loadConfig({ ...base, OPENAI_API_KEY: "forbidden" })).toThrow("OAuth-only");
    expect(() => loadConfig({ ...base, ANTHROPIC_AUTH_TOKEN: "forbidden" })).toThrow("OAuth-only");
    expect(() => loadConfig({ ...base, GOOGLE_APPLICATION_CREDENTIALS: "/tmp/forbidden.json" })).toThrow("OAuth-only");
    expect(() => loadConfig({ ...base, OPENAI_BASE_URL: "https://proxy.example" })).toThrow("OAuth-only");
    for (const key of ["REPLICATE_API_TOKEN", "HF_TOKEN", "OPENAI_KEY", "OPENROUTER_KEY", "GEMINI_KEY", "GOOGLE_AI_KEY", "AWS_BEARER_TOKEN_BEDROCK", "CLAUDE_CODE_OAUTH_TOKEN", "OPENAI_API_KEY_2"]) {
      expect(() => loadConfig({ ...base, [key]: "forbidden" })).toThrow("OAuth-only");
    }
    expect(() => loadConfig({ ...base, GITZETTE_CONTROL_PLANE_ORIGIN: "https://gitzette.online/runner" })).toThrow("origin only");
    expect(() => loadConfig({ ...base, GITZETTE_CONTROL_PLANE_ORIGIN: "http://evil.example" })).toThrow("HTTPS");
    for (const value of ["0", "1", "301", "NaN", "2.5"]) {
      expect(() => loadConfig({ ...base, GITZETTE_POLL_SECONDS: value })).toThrow("invalid GITZETTE_POLL_SECONDS");
    }
  });

  test("recognizes credential suffixes only at identifier boundaries", () => {
    expect(() => loadConfig({ ...base, MONKEY: "allowed" })).not.toThrow();
    expect(() => loadConfig({ ...base, FOO_API_KEY: "forbidden" })).toThrow("OAuth-only");
  });

  test("requires an installed deny-by-default ImageMagick coder policy", () => {
    expect(() => loadConfig({ ...base, GITZETTE_IMAGEMAGICK_POLICY: "/definitely/missing/policy.xml" }))
      .toThrow("deny-by-default coder policy is missing");
    expect(() => loadConfig({ ...base, GITZETTE_IMAGEMAGICK_POLICY: "/etc/passwd" }))
      .toThrow("deny-by-default coder policy is missing");
    const directory = mkdtempSync(join(tmpdir(), "gitzette-policy-test-"));
    const commentedPolicy = join(directory, "policy.xml");
    try {
      writeFileSync(commentedPolicy, '<!-- <policy domain="coder" rights="none" pattern="*" /> -->');
      expect(() => loadConfig({ ...base, GITZETTE_IMAGEMAGICK_POLICY: commentedPolicy }))
        .toThrow("deny-by-default coder policy is missing");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
