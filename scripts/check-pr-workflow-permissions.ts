type Document = Record<string, unknown>;

const protectedScopes = ["checks", "statuses"] as const;

function isRecord(value: unknown): value is Document {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseWorkflow(source: string): Document {
  const parsed = Bun.YAML.parse(source);
  if (!isRecord(parsed)) throw new Error("workflow must be a YAML mapping");
  return parsed;
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
  const parsed = parseWorkflow(source);
  const result = permissionsFrom(parsed.permissions, "workflow");
  if (parsed.jobs !== undefined && !isRecord(parsed.jobs)) throw new Error("workflow jobs must be a mapping");
  if (isRecord(parsed.jobs)) {
    for (const job of Object.values(parsed.jobs)) {
      if (!isRecord(job)) throw new Error("workflow job must be a mapping");
      for (const scope of permissionsFrom(job.permissions, "job")) result.add(scope);
    }
  }
  return result;
}

function workflowTriggers(source: string): Set<string> {
  const on = parseWorkflow(source).on;
  if (typeof on === "string") return new Set([on]);
  if (Array.isArray(on) && on.every((trigger) => typeof trigger === "string")) return new Set(on);
  if (isRecord(on)) return new Set(Object.keys(on));
  throw new Error("workflow on trigger must be a string, array, or mapping");
}

function workflowPrivileges(source: string): Map<string, number> {
  const parsed = parseWorkflow(source);
  const result = new Map<string, number>();
  const permissions: string[] = [...permissionsFrom(parsed.permissions, "workflow")];
  if (parsed.jobs !== undefined && !isRecord(parsed.jobs)) throw new Error("workflow jobs must be a mapping");
  if (isRecord(parsed.jobs)) {
    for (const job of Object.values(parsed.jobs)) {
      if (!isRecord(job)) throw new Error("workflow job must be a mapping");
      permissions.push(...permissionsFrom(job.permissions, "job"));
    }
  }
  for (const trigger of workflowTriggers(source)) {
    for (const permission of permissions) {
      const privilege = `${trigger}|${permission}`;
      result.set(privilege, (result.get(privilege) ?? 0) + 1);
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
  const mergeBase = runGit(cwd, ["merge-base", baseSha, headSha]);
  if (!mergeBase) throw new Error("could not resolve PR merge base");
  const output = runGit(cwd, [
    "diff", "--name-only", "-z", mergeBase.trim(), headSha, "--",
    ".github/workflows/*.yml", ".github/workflows/*.yaml",
  ]) ?? "";
  return output.split("\0").filter(Boolean);
}

function workflowAt(cwd: string, sha: string, path: string): string | null {
  if (runGit(cwd, ["cat-file", "-e", `${sha}:${path}`], true) === null) return null;
  return runGit(cwd, ["show", `${sha}:${path}`]);
}

function privilegeIsCovered(
  privilege: string,
  count: number,
  basePrivileges: Map<string, number>,
): boolean {
  const [trigger, permission] = privilege.split("|");
  const parts = permission.split(":");
  if (parts[0] === "job" && basePrivileges.has(`${trigger}|workflow:${parts.at(-1)}`)) return true;
  return (basePrivileges.get(privilege) ?? 0) >= count;
}

export function checkWorkflowChanges(cwd: string, baseSha: string, headSha: string): void {
  const files = workflowFiles(cwd, baseSha, headSha);
  if (files.length === 0) return;
  for (const path of files) {
    const headSource = workflowAt(cwd, headSha, path);
    if (headSource === null) continue;
    const baseSource = workflowAt(cwd, baseSha, path);
    const basePrivileges = baseSource === null ? new Map<string, number>() : workflowPrivileges(baseSource);
    const headPrivileges = workflowPrivileges(headSource);
    const broadened = [...headPrivileges]
      .filter(([scope, count]) => !privilegeIsCovered(scope, count, basePrivileges))
      .map(([scope]) => scope);
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
