import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
  test("resolves YAML spellings and aliases", () => {
    const sources = [
      "permissions:\n  statuses:\n    write\njobs: {}\n",
      "permissions:\n  statuses: >-\n    write\njobs: {}\n",
      "name: &access write\npermissions: {statuses: *access}\njobs: {}\n",
      "permissions: {statuses: !!str write}\njobs: {}\n",
      "permissions: write-all\njobs: {}\n",
      "permissions: {}\njobs:\n  test:\n    permissions: {checks: write}\n    runs-on: ubuntu-latest\n    steps: []\n",
    ];
    for (const source of sources) {
      expect(workflowWritePermissions(source).size).toBeGreaterThan(0);
    }
    expect(() => workflowWritePermissions("permissions: {statuses: execute}\njobs: {}\n"))
      .toThrow("statuses permission");
  });

  test("fails closed only when a changed workflow broadens protected writes", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "gitzette-workflow-permissions-"));
    directories.push(cwd);
    git(cwd, "init", "-q");
    git(cwd, "config", "user.email", "test@example.com");
    git(cwd, "config", "user.name", "test");
    await mkdir(join(cwd, ".github/workflows"), { recursive: true });
    await Bun.write(join(cwd, "README.md"), "base\n");
    await Bun.write(join(cwd, ".github/workflows/ci.yml"), "permissions: {contents: read}\njobs: {}\n");
    const base = await commit(cwd, "base");

    await Bun.write(join(cwd, "README.md"), "no workflow change\n");
    const noWorkflow = await commit(cwd, "no workflow");
    expect(() => checkWorkflowChanges(cwd, base, noWorkflow)).not.toThrow();

    await rm(join(cwd, ".github/workflows/ci.yml"));
    const deleted = await commit(cwd, "deleted workflow");
    expect(() => checkWorkflowChanges(cwd, noWorkflow, deleted)).not.toThrow();

    const large = `permissions: {statuses: write}\njobs: {}\n# ${"x".repeat(70_000)}\n`;
    await Bun.write(join(cwd, ".github/workflows/large.yml"), large);
    const privileged = await commit(cwd, "large privileged workflow");
    expect(() => checkWorkflowChanges(cwd, deleted, privileged)).toThrow("statuses");

    await Bun.write(join(cwd, ".github/workflows/large.yml"), `${large}# behavior-only change\n`);
    const unchangedPermissions = await commit(cwd, "unchanged privilege");
    expect(() => checkWorkflowChanges(cwd, privileged, unchangedPermissions)).not.toThrow();

    await Bun.write(
      join(cwd, ".github/workflows/large.yml"),
      `permissions: {statuses: write, checks: write}\njobs: {}\n# ${"x".repeat(70_000)}\n`,
    );
    const broadened = await commit(cwd, "broaden privilege");
    expect(() => checkWorkflowChanges(cwd, unchangedPermissions, broadened)).toThrow("checks");

    await Bun.write(
      join(cwd, ".github/workflows/scoped.yml"),
      "permissions: {}\njobs:\n  test:\n    permissions: {statuses: write}\n    runs-on: ubuntu-latest\n    steps: []\n",
    );
    const jobScoped = await commit(cwd, "job-scoped privilege");
    await Bun.write(
      join(cwd, ".github/workflows/scoped.yml"),
      "permissions: {statuses: write}\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps: []\n",
    );
    const workflowScoped = await commit(cwd, "workflow-scoped privilege");
    expect(() => checkWorkflowChanges(cwd, jobScoped, workflowScoped)).toThrow("workflow:statuses");
  });
});
