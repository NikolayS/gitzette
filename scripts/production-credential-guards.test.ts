import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

    const relativeCaller = Bun.spawn([
      "bash", "-c",
      'set -euo pipefail; source scripts/require-wrangler.sh; '
        + 'gitzette_require_checked_in_caller "check-schema.sh" '
        + '"scripts/check-schema.sh" "scripts/check-schema.sh" "schema-equivalence.ts"; echo OK',
    ], { cwd: repoRoot, stdout: "pipe", stderr: "pipe" });
    const [relativeExit, relativeStdout, relativeStderr] = await Promise.all([
      relativeCaller.exited,
      new Response(relativeCaller.stdout).text(),
      new Response(relativeCaller.stderr).text(),
    ]);
    expect(relativeExit).toBe(0);
    expect(relativeStderr).toBe("");
    expect(relativeStdout.trim()).toBe("OK");

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
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(script).toMatch(new RegExp(
        `gitzette_require_checked_in_caller[\\s\\\\]*"${escapedName}"`,
      ));
      const invokedSiblings = [...script.matchAll(
        /(?:bun|bash)\s+"?(?:scripts\/|\$(?:\{)?[\w]*scripts?_directory(?:\})?\/)([\w-]+\.(?:ts|sh))/g,
      )]
        .map((match) => match[1]);
      if (/\b(?:bun|bash)\s+/.test(script)) {
        expect(invokedSiblings.length, `${name} sibling invocation parser must not be vacuous`).toBeGreaterThan(0);
      }
      for (const sibling of invokedSiblings) {
        expect(script, `${name} must declare sibling ${sibling}`).toContain(`"${sibling}"`);
      }
    }
    const localSchemaGate = await Bun.file(`${repoRoot}/scripts/check-schema.sh`).text();
    expect(localSchemaGate).toMatch(/schema-equivalence\.ts[\s\\]*[\s\S]*--strict/);
    for (const name of [
      "check-production-applied-schema.sh",
      "check-production-baseline.sh",
      "check-production-drift.sh",
      "check-production-schema.sh",
    ]) {
      expect(await Bun.file(`${repoRoot}/scripts/${name}`).text()).not.toContain("--strict");
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

  test("the shared Wrangler guard is idempotent and records a physical invocation directory", async () => {
    const root = await mkdtemp(join(process.env.RUNNER_TEMP || tmpdir(), "wrangler-helper-"));
    const linkedRepo = join(root, "repo");
    try {
      await symlink(repoRoot, linkedRepo, "dir");
      const helperPath = `${repoRoot}/scripts/require-wrangler.sh`;
      const child = Bun.spawn([
        "bash", "-c",
        'set -euo pipefail; cd -L "$1"; source "$2"; source "$2"; printf "%s" "$gitzette_invocation_directory"',
        "helper-probe", linkedRepo, helperPath,
      ], { stdout: "pipe", stderr: "pipe" });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toBe(repoRoot);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("relative callers ignore a hostile CDPATH before the helper changes cwd", async () => {
    const root = await mkdtemp(join(process.env.RUNNER_TEMP || tmpdir(), "wrangler-cdpath-"));
    try {
      await mkdir(join(root, "scripts"));
      const env: Record<string, string | undefined> = { ...process.env, CDPATH: root };
      delete env.CLOUDFLARE_API_TOKEN;
      const child = Bun.spawn(["bash", "scripts/check-production-applied-schema.sh"], {
        cwd: repoRoot,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(exitCode).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toContain("CLOUDFLARE_API_TOKEN is required");
      expect(stderr).not.toContain(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a non-secrets gate rejects stdin before strict Bash mode dereferences BASH_SOURCE", async () => {
    const child = Bun.spawn(["bash", "-c", "bash < scripts/check-schema.sh"], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("check-schema.sh must be executed by path, not through stdin");
    expect(stderr).not.toContain("unbound variable");
  });
});
