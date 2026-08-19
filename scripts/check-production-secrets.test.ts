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
type WrapperInvocation = "bash-absolute" | "bash-bare" | "bash-path" | "bash-relative"
  | "direct-absolute" | "direct-relative";
type SecretCheckOptions = {
  adversarialCdPath?: boolean;
  includeToken?: boolean;
  invocation?: WrapperInvocation;
  missingSibling?: "check-production-secrets.ts" | "require-wrangler.sh";
  mode?: FakeWranglerMode;
};

async function runRawSecretCheck(
  secretList: string,
  options: SecretCheckOptions = {},
): Promise<{ exitCode: number; stdout: string; stderr: string; wranglerLog: string; fakeInvoked: boolean }> {
  const {
    adversarialCdPath = false,
    includeToken = true,
    invocation = "bash-absolute",
    missingSibling,
    mode = "success",
  } = options;
  const temporaryRoot = process.env.RUNNER_TEMP || tmpdir();
  const root = await mkdtemp(join(temporaryRoot, "gitzette-secret-check-"));
  temporaryRepositories.push(root);
  await mkdir(join(root, "scripts"), { recursive: true });
  await mkdir(join(root, "node_modules", ".bin"), { recursive: true });
  for (const file of ["check-production-secrets.sh", "check-production-secrets.ts", "require-wrangler.sh"]) {
    if (file === missingSibling) continue;
    await Bun.write(join(root, "scripts", file), Bun.file(join(repoRoot, "scripts", file)));
  }
  await chmod(join(root, "scripts", "check-production-secrets.sh"), 0o755);
  const fakeWrangler = join(root, "node_modules", ".bin", "wrangler");
  await Bun.write(fakeWrangler, `#!/usr/bin/env bash
set -euo pipefail
{
  printf 'CALL\\n'
  printf 'ARG:%s\\n' "$@"
} >>"\${FAKE_WRANGLER_ARGV_LOG:?}"
if [[ "$#" -ne 4 || "$1" != secret || "$2" != list || "$3" != --format || "$4" != json ]]; then
  echo "unexpected fake Wrangler arguments" >&2
  exit 44
fi
case "\${FAKE_WRANGLER_MODE:?}" in
  success) printf '%s\\n' "\${FAKE_SECRET_LIST:?}" ;;
  failure) echo "fake Wrangler failure" >&2; exit 42 ;;
  empty) exit 0 ;;
  *) exit 43 ;;
esac
`);
  await chmod(fakeWrangler, 0o755);

  const scriptPath = join(root, "scripts", "check-production-secrets.sh");
  const argvLog = join(root, "wrangler-argv.log");

  const environment: Record<string, string> = {
    PATH: [
      invocation === "bash-path" ? dirname(scriptPath) : undefined,
      join(root, "node_modules", ".bin"),
      dirname(process.execPath),
      process.env.PATH,
    ]
      .filter(Boolean).join(":"),
    HOME: root,
    FAKE_SECRET_LIST: secretList,
    FAKE_WRANGLER_MODE: mode,
    FAKE_WRANGLER_ARGV_LOG: argvLog,
  };
  if (adversarialCdPath) {
    const cdPath = join(root, "cdpath");
    await mkdir(join(cdPath, "scripts"), { recursive: true });
    environment.CDPATH = cdPath;
  }
  if (includeToken) environment.CLOUDFLARE_API_TOKEN = "test-only-token";
  let command: string[];
  let cwd = tmpdir();
  switch (invocation) {
    case "bash-absolute":
      command = ["bash", scriptPath];
      break;
    case "bash-bare":
      command = ["bash", scriptPath.split("/").at(-1) ?? scriptPath];
      cwd = dirname(scriptPath);
      break;
    case "bash-path":
      command = ["bash", scriptPath.split("/").at(-1) ?? scriptPath];
      break;
    case "bash-relative":
      command = ["bash", "scripts/check-production-secrets.sh"];
      cwd = root;
      break;
    case "direct-absolute":
      command = [scriptPath];
      break;
    case "direct-relative":
      command = ["./scripts/check-production-secrets.sh"];
      cwd = root;
      break;
  }
  const child = Bun.spawn(command, {
    cwd,
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const fakeInvoked = await Bun.file(argvLog).exists();
  const wranglerLog = fakeInvoked ? await Bun.file(argvLog).text() : "";
  return { exitCode, stdout, stderr, wranglerLog, fakeInvoked };
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
    expect(result.wranglerLog).toBe("CALL\nARG:secret\nARG:list\nARG:--format\nARG:json\n");
  });

  test("reproduces the deploy argv bug by rejecting a missing required secret", async () => {
    // The removed `bun -e` parser read its sole shell argument from argv[2].
    // Bun places that argument at argv[1], so the parser exited before checking
    // this mismatch. A checked-in script receives its first argument at argv[2].
    const [omitted, ...present] = expectedProductionSecrets;
    const result = await runSecretCheck(present.map(name => ({ name })));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("production Worker secret mismatch");
    expect(result.stderr).toContain(`missing=[${omitted}]`);
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
    expect(() => assertProductionSecrets({})).toThrow("invalid Wrangler secret list: expected an array");
    for (const document of [[null], [[]], [{}], [{ name: 42 }]]) {
      expect(() => assertProductionSecrets(document)).toThrow(
        "invalid Wrangler secret list: entry 0 must contain a string name",
      );
    }
    expect(() => assertProductionSecrets([{ name: "ADMIN_USER_ID" }, { name: 42 }])).toThrow(
      "invalid Wrangler secret list: entry 1 must contain a string name",
    );
    const duplicate = expectedProductionSecrets.map(name => ({ name }))
      .concat({ name: expectedProductionSecrets[0] });
    expect(() => assertProductionSecrets(duplicate)).toThrow(
      `invalid Wrangler secret list: duplicate secret name(s) [${expectedProductionSecrets[0]}]`,
    );
  });

  test("keeps the production allowlist immutable", () => {
    expect(Object.isFrozen(expectedProductionSecrets)).toBe(true);
    expect(() => (expectedProductionSecrets as string[]).push("EXTRA_SECRET")).toThrow();
  });

  test("rejects malformed JSON from Wrangler", async () => {
    const result = await runRawSecretCheck("{");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("invalid Wrangler secret list: malformed JSON");
    expect(result.stdout).toBe("");
  });

  test("fails before validation when Wrangler fails or returns an empty response", async () => {
    const failed = await runRawSecretCheck("[]", { mode: "failure" });
    expect(failed.exitCode).toBe(42);
    expect(failed.stderr).toContain("fake Wrangler failure");
    expect(failed.stdout).not.toContain("Production secrets OK");
    expect(failed.fakeInvoked).toBe(true);

    const empty = await runRawSecretCheck("unused", { mode: "empty" });
    expect(empty.exitCode).toBe(1);
    expect(empty.stderr).toContain("invalid Wrangler secret list");
    expect(empty.stdout).not.toContain("Production secrets OK");
  });

  test("requires the Cloudflare token before invoking Wrangler", async () => {
    const result = await runRawSecretCheck("[]", { includeToken: false });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("CLOUDFLARE_API_TOKEN is required");
    expect(result.stdout).toBe("");
    expect(result.fakeInvoked).toBe(false);
  });

  test("rejects wrapper copies missing either checked-in sibling", async () => {
    for (const missingSibling of ["require-wrangler.sh", "check-production-secrets.ts"] as const) {
      const result = await runRawSecretCheck("[]", { missingSibling });
      expect(result.exitCode).toBe(1);
      if (missingSibling === "require-wrangler.sh") {
        expect(result.stderr).toContain("cannot find require-wrangler.sh under resolved script directory");
      } else {
        expect(result.stderr).toContain("checked-in sibling is required:");
        expect(result.stderr).toContain("check-production-secrets.ts");
      }
      expect(result.stdout).toBe("");
      expect(result.fakeInvoked).toBe(false);
    }
  });

  test("runs directly through the shebang from the CI working directory", async () => {
    const secretList = JSON.stringify(expectedProductionSecrets.map(name => ({ name })));
    for (const invocation of ["direct-absolute", "direct-relative"] as const) {
      const result = await runRawSecretCheck(secretList, { invocation });
      expect(result.exitCode).toBe(0);
      expect(result.wranglerLog).toBe("CALL\nARG:secret\nARG:list\nARG:--format\nARG:json\n");
    }
  });

  test("resolves bash bare-name invocation from the script directory", async () => {
    const result = await runRawSecretCheck(
      JSON.stringify(expectedProductionSecrets.map(name => ({ name }))),
      { invocation: "bash-bare" },
    );
    expect(result.exitCode).toBe(0);
    expect(result.fakeInvoked).toBe(true);
    expect(result.stdout).toContain("Production secrets OK");
  });

  test("ignores CDPATH while resolving a repository-relative invocation", async () => {
    const result = await runRawSecretCheck(
      JSON.stringify(expectedProductionSecrets.map(name => ({ name }))),
      { adversarialCdPath: true, invocation: "bash-relative" },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toMatch(/^\s+at /m);
    expect(result.stdout).toContain("Production secrets OK");
  });

  test("fails loudly when the deploy gate is sourced", async () => {
    const wrapper = join(repoRoot, "scripts", "check-production-secrets.sh");
    const bash = Bun.which("bash");
    expect(bash).not.toBeNull();
    const child = Bun.spawn([bash!, "-c", `source "$1"`, "--", wrapper], {
      cwd: tmpdir(),
      env: { HOME: tmpdir(), PATH: `${dirname(bash!)}:${dirname(process.execPath)}` },
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
    expect(stderr).toContain("must be executed, not sourced");
  });

  test("fails loudly when piped to bash instead of executed by path", async () => {
    const wrapper = join(repoRoot, "scripts", "check-production-secrets.sh");
    const bash = Bun.which("bash");
    expect(bash).not.toBeNull();
    const child = Bun.spawn([bash!, "-c", `"$0" < "$1"`, bash!, wrapper], {
      cwd: tmpdir(),
      env: { HOME: tmpdir(), PATH: `${dirname(bash!)}:${dirname(process.execPath)}` },
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
    expect(stderr).toContain("must run as bash scripts/check-production-secrets.sh");
  });

  test("uses Bash's resolved path for a bare PATH invocation", async () => {
    const result = await runRawSecretCheck(
      JSON.stringify(expectedProductionSecrets.map(name => ({ name }))),
      { invocation: "bash-path" },
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
    expect(stderr).not.toMatch(/^\s+at /m);
  });

  test("preserves an actionable file-read error", async () => {
    const missingPath = join(tmpdir(), `missing-secret-list-${crypto.randomUUID()}.json`);
    const child = Bun.spawn(["bun", `${repoRoot}/scripts/check-production-secrets.ts`, missingPath], {
      cwd: tmpdir(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain(`unable to read Wrangler secret list at ${missingPath}`);
    expect(stderr).toContain("ENOENT");
    expect(stderr).not.toMatch(/^\s+at /m);
  });
});
