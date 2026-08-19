import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertReadOnlyActionsDefaults,
  auditRepositoryWorkflowRefs,
} from "./check-repository-workflow-permissions";

const directories: string[] = [];

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
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

describe("repository-wide workflow permission audit", () => {
  test("requires fail-closed live Actions defaults", () => {
    expect(() => assertReadOnlyActionsDefaults({
      default_workflow_permissions: "read",
      can_approve_pull_request_reviews: false,
    })).not.toThrow();
    expect(() => assertReadOnlyActionsDefaults({
      default_workflow_permissions: "write",
      can_approve_pull_request_reviews: false,
    })).toThrow("read-only");
    expect(() => assertReadOnlyActionsDefaults({
      default_workflow_permissions: "read",
      can_approve_pull_request_reviews: true,
    })).toThrow("unable to approve");
    expect(() => assertReadOnlyActionsDefaults([])).toThrow("must be an object");
  });

  test("allows only the default-branch publisher and OIDC-only Claude workflows", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "gitzette-repository-workflows-"));
    directories.push(cwd);
    git(cwd, "init", "-q");
    git(cwd, "config", "user.email", "test@example.com");
    git(cwd, "config", "user.name", "test");
    await mkdir(join(cwd, ".github/workflows"), { recursive: true });
    await Bun.write(
      join(cwd, ".github/workflows/samorev-gate.yml"),
      "on: pull_request_target\npermissions: {contents: read, statuses: write}\njobs: {}\n",
    );
    const claudeSource = "on: [issue_comment, pull_request_review_comment, pull_request_review, issues]\npermissions: {}\njobs:\n  claude:\n    permissions: {id-token: write}\n    runs-on: ubuntu-latest\n    steps: []\n";
    await Bun.write(join(cwd, ".github/workflows/claude.yml"), claudeSource);
    const main = await commit(cwd, "main");
    expect(() => auditRepositoryWorkflowRefs(cwd, [{ name: "main", sha: main }], main)).not.toThrow();

    await Bun.write(join(cwd, "README.md"), "safe branch\n");
    const safe = await commit(cwd, "safe branch");
    expect(() => auditRepositoryWorkflowRefs(cwd, [
      { name: "main", sha: main }, { name: "safe", sha: safe },
    ], main)).not.toThrow();

    await Bun.write(
      join(cwd, ".github/workflows/evil.yaml"),
      "on: push\npermissions: {statuses: write}\njobs: {}\n",
    );
    const evil = await commit(cwd, "evil status writer");
    expect(() => auditRepositoryWorkflowRefs(cwd, [{ name: "evil", sha: evil }], main))
      .toThrow("remote branch evil has untrusted workflow write authority");

    await rm(join(cwd, ".github/workflows/evil.yaml"));
    await Bun.write(
      join(cwd, ".github/workflows/claude.yml"),
      "on: [issue_comment, pull_request_review_comment, pull_request_review, issues]\npermissions: {}\njobs:\n  claude:\n    permissions: {id-token: write}\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo changed\n",
    );
    const changedClaude = await commit(cwd, "changed Claude workflow");
    expect(() => auditRepositoryWorkflowRefs(cwd, [{ name: "changed", sha: changedClaude }], main))
      .not.toThrow();

    await Bun.write(
      join(cwd, ".github/workflows/claude.yml"),
      claudeSource.replace("issues]", "issues, push]"),
    );
    const pushClaude = await commit(cwd, "push-capable Claude workflow");
    expect(() => auditRepositoryWorkflowRefs(cwd, [{ name: "push-claude", sha: pushClaude }], main))
      .toThrow("untrusted workflow write authority in .github/workflows/claude.yml");

    await Bun.write(join(cwd, ".github/workflows/claude.yml"), claudeSource);
    await Bun.write(
      join(cwd, ".github/workflows/samorev-gate.yml"),
      "on: [pull_request_target, push]\npermissions: {contents: read, statuses: write}\njobs: {}\n",
    );
    const pushPublisher = await commit(cwd, "push-capable publisher");
    expect(() => auditRepositoryWorkflowRefs(cwd, [{ name: "push", sha: pushPublisher }], main))
      .toThrow("untrusted workflow write authority in .github/workflows/samorev-gate.yml");

    await Bun.write(
      join(cwd, ".github/workflows/evil-environment.yml"),
      "on: push\npermissions: {contents: read}\njobs:\n  deploy:\n    environment: {name: production}\n    runs-on: ubuntu-latest\n    steps: []\n",
    );
    const environment = await commit(cwd, "untrusted environment workflow");
    expect(() => auditRepositoryWorkflowRefs(cwd, [{ name: "environment", sha: environment }], main))
      .toThrow("untrusted environment authority");
  });
});
