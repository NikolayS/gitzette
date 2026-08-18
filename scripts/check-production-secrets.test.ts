import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertProductionSecrets, expectedProductionSecrets } from "./check-production-secrets";

const repoRoot = fileURLToPath(new URL("../", import.meta.url)).replace(/[\\/]$/, "");
const temporaryRepositories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRepositories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function runRawSecretCheck(secretList: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
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
      FAKE_SECRET_LIST: secretList,
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

function runSecretCheck(secrets: unknown) {
  return runRawSecretCheck(JSON.stringify(secrets));
}

describe("production secret preflight", () => {
  test("passes the Wrangler JSON path through the shell to the Bun entrypoint", async () => {
    const result = await runSecretCheck(expectedProductionSecrets.map(name => ({ name, type: "secret_text" })));
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("secret mismatch");
    expect(result.stdout).toContain("Production secrets OK");
  });

  test("fails closed when the Wrangler response is missing a required secret", async () => {
    const result = await runSecretCheck(expectedProductionSecrets.slice(1).map(name => ({ name })));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("production Worker secret mismatch");
    expect(result.stderr).toContain("missing=[ADMIN_USER_ID]");
    expect(result.stdout).toBe("");
  });

  test("fails closed when Wrangler reports a retired or unknown secret", async () => {
    const result = await runSecretCheck([
      ...expectedProductionSecrets.map(name => ({ name })),
      { name: "OPENAI_API_KEY" },
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("retired-or-unknown=[OPENAI_API_KEY]");
  });

  test("rejects malformed Wrangler secret-list shapes", () => {
    for (const document of [{}, [null], [[]], [{}], [{ name: 42 }]]) {
      expect(() => assertProductionSecrets(document)).toThrow("invalid Wrangler secret list");
    }
  });

  test("rejects malformed JSON from Wrangler", async () => {
    const result = await runRawSecretCheck("{");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("SyntaxError");
    expect(result.stdout).toBe("");
  });

  test("requires the secret-list argv path", async () => {
    const child = Bun.spawn(["bun", `${repoRoot}/scripts/check-production-secrets.ts`], {
      cwd: tmpdir(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Wrangler secret-list path is required");
  });
});
