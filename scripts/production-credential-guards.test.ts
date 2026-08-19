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

    const wranglerCallers = [
      "bootstrap-production-db.sh",
      "check-production-applied-schema.sh",
      "check-production-baseline.sh",
      "check-production-drift.sh",
      "check-production-schema.sh",
      "check-production-secrets.sh",
      "check-schema.sh",
      "check-weekly-profiles.sh",
      "e2e.sh",
    ];
    for (const name of wranglerCallers) {
      const script = await Bun.file(`${repoRoot}/scripts/${name}`).text();
      expect(script).toContain("gitzette_require_checked_in_caller");
    }
  });

  test("local-only scripts centrally clear every Wrangler credential alias", async () => {
    const helperPath = `${repoRoot}/scripts/require-wrangler.sh`;
    const credentials = [
      "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_D1_TOKEN",
      "CLOUDFLARE_EMAIL", "CLOUDFLARE_API_KEY", "CF_API_TOKEN", "CF_ACCOUNT_ID",
    ];
    const env = { ...process.env };
    for (const name of credentials) env[name] = "must-not-survive";
    const child = Bun.spawn([
      "bash", "-c",
      'set -euo pipefail; source "$1"; gitzette_require_local; env',
      "local-credential-probe", helperPath,
    ], { cwd: "/tmp", env, stdout: "pipe", stderr: "pipe" });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    for (const name of credentials) expect(stdout).not.toContain(`${name}=`);

    for (const script of ["check-production-baseline.sh", "check-schema.sh", "e2e.sh"]) {
      expect(await Bun.file(`${repoRoot}/scripts/${script}`).text()).toContain("gitzette_require_local");
    }
  });
});
