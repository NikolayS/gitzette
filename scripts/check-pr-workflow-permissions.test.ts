import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkWorkflowChanges, workflowWritePermissions } from "./check-pr-workflow-permissions";

const directories: string[] = [];

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
  expect(new TextDecoder().decode(result.stderr), `git ${args.join(" ")}`).toBe("");
  expect(result.exitCode, `git ${args.join(" ")}`).toBe(0);
  return new TextDecoder().decode(result.stdout).trim();
}

async function commit(cwd: string, message: string): Promise<string> {
  git(cwd, "add", "-A");
  git(cwd, "commit", "-qm", message);
  return git(cwd, "rev-parse", "HEAD");
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("base-controlled workflow permission boundary", () => {
  test("keeps protected write authority in the base-controlled publisher only", async () => {
    const privileged: Record<string, string[]> = {};
    for (const name of await readdir(".github/workflows")) {
      const source = await Bun.file(join(".github/workflows", name)).text();
      const permissions = [...workflowWritePermissions(source)].sort();
      if (permissions.length > 0) privileged[name] = permissions;
    }
    expect(privileged).toEqual({ "samorev-gate.yml": ["workflow:statuses"] });
  });

  test("resolves YAML spellings and aliases", () => {
    const cases: Array<[string, string[]]> = [
      ["permissions:\n  statuses:\n    write\njobs: {}\n", ["workflow:statuses"]],
      ["permissions:\n  statuses: >-\n    write\njobs: {}\n", ["workflow:statuses"]],
      ["name: &access write\npermissions: {statuses: *access}\njobs: {}\n", ["workflow:statuses"]],
      ["permissions: {statuses: !!str write}\njobs: {}\n", ["workflow:statuses"]],
      ["permissions: write-all\njobs: {}\n", ["workflow:checks", "workflow:statuses"]],
      [
        "permissions: {}\njobs:\n  test:\n    permissions: {checks: write}\n    runs-on: ubuntu-latest\n    steps: []\n",
        ["job:checks"],
      ],
      [
        "on: pull_request\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps: []\n",
        ["job:checks", "job:statuses"],
      ],
      [
        "on: pull_request\njobs:\n  test:\n    permissions: {contents: read}\n    runs-on: ubuntu-latest\n    steps: []\n",
        [],
      ],
    ];
    for (const [source, expected] of cases) {
      expect([...workflowWritePermissions(source)].sort()).toEqual(expected);
    }
    expect(() => workflowWritePermissions("permissions: {statuses: execute}\njobs: {}\n"))
      .toThrow("statuses permission");
  });

  test("fails closed on privilege broadening and privileged workflow content changes", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "gitzette-workflow-permissions-"));
    directories.push(cwd);
    git(cwd, "init", "-q");
    git(cwd, "config", "user.email", "test@example.com");
    git(cwd, "config", "user.name", "test");
    await mkdir(join(cwd, ".github/workflows"), { recursive: true });
    await Bun.write(join(cwd, "README.md"), "base\n");
    await Bun.write(join(cwd, ".github/workflows/ci.yml"), "on: pull_request\npermissions: {contents: read}\njobs: {}\n");
    const base = await commit(cwd, "base");

    await Bun.write(join(cwd, "README.md"), "no workflow change\n");
    const noWorkflow = await commit(cwd, "no workflow");
    expect(() => checkWorkflowChanges(cwd, base, noWorkflow)).not.toThrow();

    await rm(join(cwd, ".github/workflows/ci.yml"));
    const deleted = await commit(cwd, "deleted workflow");
    expect(() => checkWorkflowChanges(cwd, noWorkflow, deleted)).not.toThrow();

    const large = `on:\n  pull_request_target:\n    branches: [main]\n    types: [opened, synchronize]\npermissions: {statuses: write}\njobs: {}\n# ${"x".repeat(70_000)}\n`;
    await Bun.write(join(cwd, ".github/workflows/large.yml"), large);
    const privileged = await commit(cwd, "large privileged workflow");
    expect(() => checkWorkflowChanges(cwd, deleted, privileged)).toThrow("statuses");

    await Bun.write(join(cwd, "README.md"), "privileged workflow unchanged\n");
    const privilegedUnchanged = await commit(cwd, "unrelated change with privileged workflow");
    expect(() => checkWorkflowChanges(cwd, privileged, privilegedUnchanged)).toThrow("untrusted workflow");

    await Bun.write(join(cwd, ".github/workflows/large.yml"), `${large}# behavior-only change\n`);
    const unchangedPermissions = await commit(cwd, "unchanged privilege");
    expect(() => checkWorkflowChanges(cwd, privilegedUnchanged, unchangedPermissions)).toThrow("changes the content of privileged workflow");

    await Bun.write(
      join(cwd, ".github/workflows/large.yml"),
      large.replace("  pull_request_target:\n", "  pull_request_target:\n  push:\n"),
    );
    const broadenedTrigger = await commit(cwd, "broaden trigger");
    expect(() => checkWorkflowChanges(cwd, unchangedPermissions, broadenedTrigger)).toThrow("push");

    await Bun.write(
      join(cwd, ".github/workflows/large.yml"),
      `on: pull_request_target\npermissions: {statuses: write, checks: write}\njobs: {}\n# ${"x".repeat(70_000)}\n`,
    );
    const broadened = await commit(cwd, "broaden privilege");
    expect(() => checkWorkflowChanges(cwd, unchangedPermissions, broadened)).toThrow("checks");

    await Bun.write(
      join(cwd, ".github/workflows/scoped.yml"),
      "on: pull_request_target\npermissions: {}\njobs:\n  test:\n    permissions: {statuses: write}\n    runs-on: ubuntu-latest\n    steps: []\n",
    );
    const jobScoped = await commit(cwd, "job-scoped privilege");
    await Bun.write(
      join(cwd, ".github/workflows/scoped.yml"),
      "on: pull_request_target\npermissions: {statuses: write}\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps: []\n",
    );
    const workflowScoped = await commit(cwd, "workflow-scoped privilege");
    expect(() => checkWorkflowChanges(cwd, jobScoped, workflowScoped)).toThrow("workflow:statuses");

    await Bun.write(
      join(cwd, ".github/workflows/scoped.yml"),
      "on: pull_request_target\npermissions: {}\njobs:\n  renamed:\n    permissions: {statuses: write}\n    runs-on: ubuntu-latest\n    steps: []\n",
    );
    const renamedJob = await commit(cwd, "rename privileged job");
    expect(() => checkWorkflowChanges(cwd, jobScoped, renamedJob)).toThrow("job:renamed:statuses");

    await Bun.write(
      join(cwd, ".github/workflows/implicit.yml"),
      "on: pull_request\njobs:\n  attacker:\n    runs-on: ubuntu-latest\n    steps: []\n",
    );
    const implicitDefault = await commit(cwd, "implicit default");
    expect(() => checkWorkflowChanges(cwd, renamedJob, implicitDefault)).toThrow("job:attacker:checks");

    await Bun.write(
      join(cwd, ".github/workflows/implicit.yml"),
      "on: pull_request\npermissions: {}\njobs:\n  attacker:\n    permissions: {statuses: write}\n    runs-on: ubuntu-latest\n    steps: []\n",
    );
    const explicitWrite = await commit(cwd, "explicit write after implicit base");
    expect(() => checkWorkflowChanges(cwd, implicitDefault, explicitWrite)).toThrow("job:attacker:statuses");
  });
});
