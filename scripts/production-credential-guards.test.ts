import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url)).replace(/[\\/]$/, "");

describe("production migration credential guards", () => {
  test("fails explicitly before Wrangler when the applied-schema token is absent", async () => {
    const env = { ...process.env };
    delete env.CLOUDFLARE_API_TOKEN;
    delete env.CLOUDFLARE_ACCOUNT_ID;
    delete env.CLOUDFLARE_D1_TOKEN;
    const child = Bun.spawn(["bash", `${repoRoot}/scripts/check-production-applied-schema.sh`], {
      cwd: "/tmp",
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("CLOUDFLARE_API_TOKEN is required for the read-only applied-schema gate");
    expect(stderr).not.toContain("wrangler");
  });

  test("uses a bash-3.2-compatible guard and anchors callers to the repository", async () => {
    const helperPath = `${repoRoot}/scripts/require-wrangler.sh`;
    const helper = await Bun.file(helperPath).text();
    expect(helper).not.toMatch(/\[\[\s+!?\s*-v\s/);
    expect(helper).toContain("${wrangler_bin+set}");

    const child = Bun.spawn([
      "bash",
      "-c",
      'set -euo pipefail; source "$1"; printf "%s\\n%s\\n" "$PWD" "$wrangler_bin"',
      "require-wrangler-probe",
      helperPath,
    ], {
      cwd: "/tmp",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout.trim().split("\n")).toEqual([
      repoRoot,
      `${repoRoot}/node_modules/.bin/wrangler`,
    ]);
  });
});
