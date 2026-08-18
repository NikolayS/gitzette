import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url)).replace(/[\\/]$/, "");
const temporaryRepositories: string[] = [];
const expectedSecrets = [
  "ADMIN_USER_ID",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "RUNNER_SECRET",
  "SESSION_SECRET",
  "STATUS_TOKEN",
];

afterEach(async () => {
  await Promise.all(temporaryRepositories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function runSecretCheck(secrets: unknown): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const root = await mkdtemp(join(tmpdir(), "gitzette-secret-check-"));
  temporaryRepositories.push(root);
  await mkdir(join(root, "scripts"), { recursive: true });
  await mkdir(join(root, "node_modules", ".bin"), { recursive: true });
  for (const file of ["check-production-secrets.sh", "check-production-secrets.ts", "require-wrangler.sh"]) {
    await Bun.write(join(root, "scripts", file), Bun.file(join(repoRoot, "scripts", file)));
  }
  const fakeWrangler = join(root, "node_modules", ".bin", "wrangler");
  await Bun.write(fakeWrangler, `#!/usr/bin/env bash\nset -euo pipefail\nprintf '%s\\n' "\${FAKE_SECRET_LIST:?}"\n`);
  await chmod(fakeWrangler, 0o755);

  const child = Bun.spawn(["bash", join(root, "scripts", "check-production-secrets.sh")], {
    cwd: tmpdir(),
    env: {
      ...process.env,
      CLOUDFLARE_API_TOKEN: "test-only-token",
      FAKE_SECRET_LIST: JSON.stringify(secrets),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe("production secret preflight", () => {
  test("passes the Wrangler JSON path through the shell to the Bun entrypoint", async () => {
    const result = await runSecretCheck(expectedSecrets.map(name => ({ name, type: "secret_text" })));
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Production secrets OK");
  });

  test("fails closed when the Wrangler response is missing a required secret", async () => {
    const result = await runSecretCheck(expectedSecrets.slice(1).map(name => ({ name })));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("production Worker secret mismatch");
    expect(result.stderr).toContain("missing=[ADMIN_USER_ID]");
    expect(result.stdout).toBe("");
  });
});
