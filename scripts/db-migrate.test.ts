import { afterEach, describe, expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let workspace = "";
afterEach(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true });
  workspace = "";
});

describe("production migration orchestration", () => {
  test("runs the complete db:migrate chain from an unmigrated database", async () => {
    const root = new URL("..", import.meta.url).pathname;
    workspace = await mkdtemp(join(tmpdir(), "gitzette-migration-test-"));
    await cp(join(root, "package.json"), join(workspace, "package.json"));
    await cp(join(root, "scripts"), join(workspace, "scripts"), { recursive: true });
    await cp(join(root, "migrations"), join(workspace, "migrations"), { recursive: true });
    await cp(join(root, "fixtures"), join(workspace, "fixtures"), { recursive: true });
    await mkdir(join(workspace, "node_modules", ".bin"), { recursive: true });

    const wrangler = join(workspace, "node_modules", ".bin", "wrangler");
    await writeFile(wrangler, `#!/usr/bin/env bash
set -euo pipefail
args="$*"
if [[ "$args" == *"SELECT COUNT(*) AS total"* ]]; then
  printf '%s\\n' '[{"results":[{"total":0}]}]'
elif [[ "$args" == *"GROUP BY lower(username)"* ]]; then
  printf '%s\\n' '[{"results":[]}]'
elif [[ "$args" == *"sqlite_master"* && "$args" == *"--json"* ]]; then
  printf '%s\\n' '[{"results":[]}]'
elif [[ "$args" == "d1 migrations apply gitzette-db --remote" ]]; then
  echo 'Mock remote migration apply OK'
fi
`);
    await chmod(wrangler, 0o755);

    const process = Bun.spawn(["bun", "run", "db:migrate"], {
      cwd: workspace,
      env: {
        ...Bun.env,
        CLOUDFLARE_API_TOKEN: "integration-test-token",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);

    expect(exitCode, stderr).toBe(0);
    expect(stdout).toContain("Production username collision preflight OK: zero case-fold collisions");
    expect(stdout).toContain("Production cutover gate OK: unmigrated live D1 matches the reviewed baseline");
    expect(stdout).toContain("Applied-schema gate skipped: pre-cutover baseline gate owns the unmigrated database");
    expect(stdout).toContain("Mock remote migration apply OK");
    expect(stdout).toContain("Production schema OK: live D1 matches the complete reviewed migration chain");
  });

  test("bootstraps only a brand-new empty production database", async () => {
    const root = new URL("..", import.meta.url).pathname;
    workspace = await mkdtemp(join(tmpdir(), "gitzette-bootstrap-test-"));
    await cp(join(root, "package.json"), join(workspace, "package.json"));
    await cp(join(root, "scripts"), join(workspace, "scripts"), { recursive: true });
    await cp(join(root, "migrations"), join(workspace, "migrations"), { recursive: true });
    await mkdir(join(workspace, "node_modules", ".bin"), { recursive: true });

    const wrangler = join(workspace, "node_modules", ".bin", "wrangler");
    await writeFile(wrangler, `#!/usr/bin/env bash
set -euo pipefail
args="$*"
if [[ "$args" == *"SELECT COUNT(*) AS total"* ]]; then
  printf '%s\\n' '[{"results":[{"total":0}]}]'
elif [[ "$args" == "d1 migrations apply gitzette-db --remote" ]]; then
  echo 'Mock fresh remote migration apply OK'
elif [[ "$args" == *"sqlite_master"* && "$args" == *"--json"* ]]; then
  printf '%s\\n' '[{"results":[]}]'
fi
`);
    await chmod(wrangler, 0o755);

    const process = Bun.spawn(["bun", "run", "db:bootstrap"], {
      cwd: workspace,
      env: {
        ...Bun.env,
        CLOUDFLARE_API_TOKEN: "integration-test-token",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);

    expect(exitCode, stderr).toBe(0);
    expect(stdout).toContain("Mock fresh remote migration apply OK");
    expect(stdout).toContain("Production schema OK: live D1 matches the complete reviewed migration chain");
    expect(stdout).toContain("Production bootstrap OK: empty D1 now matches the complete reviewed migration chain");
  });

  test("rejects production bootstrap when any application table exists", async () => {
    const root = new URL("..", import.meta.url).pathname;
    workspace = await mkdtemp(join(tmpdir(), "gitzette-bootstrap-reject-test-"));
    await cp(join(root, "package.json"), join(workspace, "package.json"));
    await cp(join(root, "scripts"), join(workspace, "scripts"), { recursive: true });
    await mkdir(join(workspace, "node_modules", ".bin"), { recursive: true });

    const wrangler = join(workspace, "node_modules", ".bin", "wrangler");
    await writeFile(wrangler, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *"SELECT COUNT(*) AS total"* ]]; then
  printf '%s\\n' '[{"results":[{"total":1}]}]'
  exit 0
fi
echo 'unexpected mutation after non-empty bootstrap check' >&2
exit 99
`);
    await chmod(wrangler, 0o755);

    const process = Bun.spawn(["bun", "run", "db:bootstrap"], {
      cwd: workspace,
      env: {
        ...Bun.env,
        CLOUDFLARE_API_TOKEN: "integration-test-token",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([
      new Response(process.stderr).text(),
      process.exited,
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("production bootstrap requires a brand-new empty D1 database");
    expect(stderr).not.toContain("unexpected mutation");
  });
});
