import {
  explicitWorkflowWritePermissions,
  workflowAt,
  workflowTriggers,
} from "./check-pr-workflow-permissions";

export type RepositoryRef = { name: string; sha: string };

function runGit(cwd: string, args: string[]): string {
  const result = Bun.spawnSync({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr).trim() || `git ${args[0]} failed`);
  }
  return new TextDecoder().decode(result.stdout);
}

function runCommand(cwd: string, command: string, args: string[]): string {
  const result = Bun.spawnSync({ cmd: [command, ...args], cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr).trim() || `${command} ${args[0]} failed`);
  }
  return new TextDecoder().decode(result.stdout);
}

export function assertReadOnlyActionsDefaults(document: unknown): void {
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("Actions workflow permission response must be an object");
  }
  const policy = document as Record<string, unknown>;
  if (policy.default_workflow_permissions !== "read" || policy.can_approve_pull_request_reviews !== false) {
    throw new Error("Actions workflow defaults must be read-only and unable to approve pull requests");
  }
}

function checkActionsWorkflowDefaults(cwd: string): void {
  const repositoryDocument = process.env.GITHUB_REPOSITORY ? null :
    JSON.parse(runCommand(cwd, "gh", ["repo", "view", "--json", "nameWithOwner"]));
  const repository = process.env.GITHUB_REPOSITORY || repositoryDocument?.nameWithOwner;
  if (typeof repository !== "string" || repository.length === 0) {
    throw new Error("could not resolve repository for Actions workflow permission audit");
  }
  const response = runCommand(cwd, "gh", ["api", `repos/${repository}/actions/permissions/workflow`]);
  assertReadOnlyActionsDefaults(JSON.parse(response));
}

function workflowPaths(cwd: string, sha: string): string[] {
  return runGit(cwd, ["ls-tree", "-r", "--name-only", "-z", sha, "--", ".github/workflows"])
    .split("\0")
    .filter((path) => /\.ya?ml$/.test(path));
}

export function auditRepositoryWorkflowRefs(
  cwd: string,
  refs: RepositoryRef[],
  trustedMainSha: string,
): void {
  if (workflowAt(cwd, trustedMainSha, ".github/workflows/claude.yml") === null) {
    throw new Error("trusted main Claude workflow is missing");
  }
  for (const ref of refs) {
    for (const path of workflowPaths(cwd, ref.sha)) {
      const source = workflowAt(cwd, ref.sha, path);
      if (source === null) throw new Error(`could not read ${path} from ${ref.name}`);
      const writes = [...explicitWorkflowWritePermissions(source)].sort();
      if (writes.length === 0) continue;
      const triggers = [...workflowTriggers(source)].sort();
      const defaultBranchOnlyPublisher = path === ".github/workflows/samorev-gate.yml" &&
        writes.join(",") === "workflow:statuses" &&
        triggers.join(",") === "pull_request_target";
      const claudeOidcOnly = path === ".github/workflows/claude.yml" &&
        writes.join(",") === "job:id-token" &&
        triggers.join(",") === "issue_comment,issues,pull_request_review,pull_request_review_comment";
      if (!defaultBranchOnlyPublisher && !claudeOidcOnly) {
        throw new Error(
          `remote branch ${ref.name} has untrusted workflow write authority in ${path}: ${writes.join(", ")}`,
        );
      }
    }
  }
}

function remoteHeads(cwd: string): { snapshot: string; refs: RepositoryRef[] } {
  const snapshot = runGit(cwd, ["ls-remote", "--heads", "origin"])
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort()
    .join("\n");
  const refs = snapshot.split("\n").filter(Boolean).map((line) => {
    const match = line.match(/^([0-9a-f]{40})\trefs\/heads\/(.+)$/);
    if (!match) throw new Error(`could not parse remote head: ${line}`);
    return { sha: match[1], name: match[2] };
  });
  return { snapshot, refs };
}

export function checkRepositoryWorkflowPermissions(cwd: string): void {
  checkActionsWorkflowDefaults(cwd);
  const before = remoteHeads(cwd);
  const main = before.refs.find(({ name }) => name === "main");
  if (!main) throw new Error("remote main branch is missing");
  runGit(cwd, [
    "fetch", "--no-tags", "--force", "origin",
    "+refs/heads/*:refs/gitzette/repository-audit/*",
  ]);
  for (const ref of before.refs) {
    const fetched = runGit(cwd, ["rev-parse", `refs/gitzette/repository-audit/${ref.name}`]).trim();
    if (fetched !== ref.sha) throw new Error(`remote branch ${ref.name} changed while it was fetched`);
  }
  auditRepositoryWorkflowRefs(cwd, before.refs, main.sha);
  const after = remoteHeads(cwd);
  if (after.snapshot !== before.snapshot) {
    throw new Error("remote branches changed during the repository workflow audit; rerun it");
  }
}

if (import.meta.main) {
  try {
    checkRepositoryWorkflowPermissions(process.cwd());
    console.log("Repository workflow permissions OK");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
