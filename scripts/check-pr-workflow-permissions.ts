type Document = Record<string, unknown>;

const protectedScopes = ["checks", "statuses"] as const;

function isRecord(value: unknown): value is Document {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function permissionsFrom(value: unknown, location: string): Set<string> {
  if (value === undefined || value === null || value === "read-all") return new Set();
  if (value === "write-all") return new Set(protectedScopes.map((scope) => `${location}:${scope}`));
  if (!isRecord(value)) throw new Error("permissions must be a mapping, read-all, or write-all");
  const result = new Set<string>();
  for (const scope of protectedScopes) {
    const access = value[scope];
    if (access === "write") result.add(`${location}:${scope}`);
    else if (access !== undefined && access !== "read" && access !== "none") {
      throw new Error(`${scope} permission must be read, write, or none`);
    }
  }
  return result;
}

export function workflowWritePermissions(source: string): Set<string> {
  const parsed = Bun.YAML.parse(source);
  if (!isRecord(parsed)) throw new Error("workflow must be a YAML mapping");
  const result = permissionsFrom(parsed.permissions, "workflow");
  if (parsed.jobs !== undefined && !isRecord(parsed.jobs)) throw new Error("workflow jobs must be a mapping");
  if (isRecord(parsed.jobs)) {
    for (const [name, job] of Object.entries(parsed.jobs)) {
      if (!isRecord(job)) throw new Error("workflow job must be a mapping");
      for (const scope of permissionsFrom(job.permissions, `job:${name}`)) result.add(scope);
    }
  }
  return result;
}

function runGit(cwd: string, args: string[], allowFailure = false): string | null {
  const result = Bun.spawnSync({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    if (allowFailure) return null;
    throw new Error(new TextDecoder().decode(result.stderr).trim() || `git ${args[0]} failed`);
  }
  return new TextDecoder().decode(result.stdout);
}

function workflowFiles(cwd: string, baseSha: string, headSha: string): string[] {
  const output = runGit(cwd, [
    "diff", "--name-only", "-z", baseSha, headSha, "--",
    ".github/workflows/*.yml", ".github/workflows/*.yaml",
  ]) ?? "";
  return output.split("\0").filter(Boolean);
}

function workflowAt(cwd: string, sha: string, path: string): string | null {
  if (runGit(cwd, ["cat-file", "-e", `${sha}:${path}`], true) === null) return null;
  return runGit(cwd, ["show", `${sha}:${path}`]);
}

function permissionIsCovered(permission: string, basePermissions: Set<string>): boolean {
  if (basePermissions.has(permission)) return true;
  const parts = permission.split(":");
  return parts[0] === "job" && basePermissions.has(`workflow:${parts.at(-1)}`);
}

export function checkWorkflowChanges(cwd: string, baseSha: string, headSha: string): void {
  const files = workflowFiles(cwd, baseSha, headSha);
  if (files.length === 0) return;
  for (const path of files) {
    const headSource = workflowAt(cwd, headSha, path);
    if (headSource === null) continue;
    const baseSource = workflowAt(cwd, baseSha, path);
    const basePermissions = baseSource === null ? new Set<string>() : workflowWritePermissions(baseSource);
    const headPermissions = workflowWritePermissions(headSource);
    const broadened = [...headPermissions].filter((scope) => !permissionIsCovered(scope, basePermissions));
    if (broadened.length > 0) {
      throw new Error(`PR broadens privileged workflow permissions in ${path}: ${broadened.join(", ")}`);
    }
  }
}

if (import.meta.main) {
  const [baseSha, headSha, ...extra] = process.argv.slice(2);
  if (!baseSha || !headSha || extra.length > 0) {
    console.error("usage: bun scripts/check-pr-workflow-permissions.ts <base-sha> <head-sha>");
    process.exit(1);
  }
  try {
    checkWorkflowChanges(process.cwd(), baseSha, headSha);
    console.log("PR workflow permissions OK");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
