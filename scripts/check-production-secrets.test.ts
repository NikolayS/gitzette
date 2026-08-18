import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertProductionSecrets, expectedProductionSecrets } from "./check-production-secrets";

const repoRoot = fileURLToPath(new URL("../", import.meta.url)).replace(/[\\/]$/, "");
const temporaryRepositories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRepositories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

type FakeWranglerMode = "success" | "failure" | "empty";

async function runRawSecretCheck(
  secretList: string,
  mode: FakeWranglerMode = "success",
  throughSymlink = false,
): Promise<{ exitCode: number; stdout: string; stderr: string; wranglerArgv: string[]; fakeInvoked: boolean }> {
  const root = await mkdtemp(join(tmpdir(), "gitzette-secret-check-"));
  temporaryRepositories.push(root);
  await mkdir(join(root, "scripts"), { recursive: true });
  await mkdir(join(root, "node_modules", ".bin"), { recursive: true });
  for (const file of ["check-production-secrets.sh", "check-production-secrets.ts", "require-wrangler.sh"]) {
    await Bun.write(join(root, "scripts", file), Bun.file(join(repoRoot, "scripts", file)));
  }
  const fakeWrangler = join(root, "node_modules", ".bin", "wrangler");
  await Bun.write(fakeWrangler, `#!/bin/bash
set -euo pipefail
printf '%s\\n' "$@" >"\${FAKE_WRANGLER_ARGV_LOG:?}"
case "\${FAKE_WRANGLER_MODE:?}" in
  success) printf '%s\\n' "\${FAKE_SECRET_LIST:?}" ;;
  failure) echo "fake Wrangler failure" >&2; exit 42 ;;
  empty) exit 0 ;;
  *) exit 43 ;;
esac
`);
  await chmod(fakeWrangler, 0o755);

  let scriptPath = join(root, "scripts", "check-production-secrets.sh");
  if (throughSymlink) {
    await mkdir(join(root, "bin"), { recursive: true });
    scriptPath = join(root, "bin", "production-secrets");
    const linked = Bun.spawn(["ln", "-s", "../scripts/check-production-secrets.sh", scriptPath]);
    expect(await linked.exited).toBe(0);
  }
  const argvLog = join(root, "wrangler-argv.log");

  const child = Bun.spawn(["bash", scriptPath], {
    cwd: tmpdir(),
    env: {
      PATH: `${join(root, "node_modules", ".bin")}:${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: root,
      CLOUDFLARE_API_TOKEN: "test-only-token",
      FAKE_SECRET_LIST: secretList,
      FAKE_WRANGLER_MODE: mode,
      FAKE_WRANGLER_ARGV_LOG: argvLog,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const fakeInvoked = await Bun.file(argvLog).exists();
  const wranglerArgv = fakeInvoked
    ? (await Bun.file(argvLog).text()).trim().split("\n").filter(Boolean)
    : [];
  return { exitCode, stdout, stderr, wranglerArgv, fakeInvoked };
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
    expect(result.fakeInvoked).toBe(true);
    expect(result.wranglerArgv).toEqual(["secret", "list", "--format", "json"]);
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
    expect(result.stdout).toBe("");
  });

  test("rejects malformed Wrangler secret-list shapes", () => {
    for (const document of [
      {}, [null], [[]], [{}], [{ name: 42 }],
      expectedProductionSecrets.map(name => ({ name })).concat({ name: expectedProductionSecrets[0] }),
    ]) {
      expect(() => assertProductionSecrets(document)).toThrow("invalid Wrangler secret list");
    }
  });

  test("rejects malformed JSON from Wrangler", async () => {
    const result = await runRawSecretCheck("{");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("invalid Wrangler secret list");
    expect(result.stdout).toBe("");
  });

  test("fails before validation when Wrangler fails or returns an empty response", async () => {
    const failed = await runRawSecretCheck("[]", "failure");
    expect(failed.exitCode).toBe(42);
    expect(failed.stderr).toContain("fake Wrangler failure");
    expect(failed.stdout).not.toContain("Production secrets OK");
    expect(failed.fakeInvoked).toBe(true);

    const empty = await runRawSecretCheck("unused", "empty");
    expect(empty.exitCode).toBe(1);
    expect(empty.stderr).toContain("invalid Wrangler secret list");
    expect(empty.stdout).not.toContain("Production secrets OK");
  });

  test("resolves the checked entrypoint through a symlinked wrapper", async () => {
    const result = await runRawSecretCheck(
      JSON.stringify(expectedProductionSecrets.map(name => ({ name }))),
      "success",
      true,
    );
    expect(result.exitCode).toBe(0);
    expect(result.fakeInvoked).toBe(true);
    expect(result.stdout).toContain("Production secrets OK");
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
