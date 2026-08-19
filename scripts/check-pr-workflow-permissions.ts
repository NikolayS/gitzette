type Document = Record<string, unknown>;

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
  if (value === "write-all") return new Set([`${location}:write-all`]);
  if (!isRecord(value)) throw new Error("permissions must be a mapping, read-all, or write-all");
  const result = new Set<string>();
  for (const [scope, access] of Object.entries(value)) {
    if (access === "write") result.add(`${location}:${scope}`);
    else if (access !== "read" && access !== "none") {
      throw new Error(`${scope} permission must be read, write, or none`);
    }
  }
  return result;
}

function effectiveProtectedPermissions(
  parsed: Document,
  includeJobNames: boolean,
  conservativeMissing: boolean,
): string[] {
  const workflowPermissionsDefined = parsed.permissions !== undefined && parsed.permissions !== null;
  const permissions = workflowPermissionsDefined ? [...permissionsFrom(parsed.permissions, "workflow")] : [];
  if (parsed.jobs !== undefined && !isRecord(parsed.jobs)) throw new Error("workflow jobs must be a mapping");
  if (isRecord(parsed.jobs)) {
    for (const [name, job] of Object.entries(parsed.jobs)) {
      if (!isRecord(job)) throw new Error("workflow job must be a mapping");
      const location = includeJobNames ? `job:${name}` : "job";
      if (conservativeMissing && !workflowPermissionsDefined && (job.permissions === undefined || job.permissions === null)) {
        // Repository defaults can drift. Missing workflow and job permissions
        // are conservatively treated as write-all.
        permissions.push(`${location}:write-all`);
      } else {
        permissions.push(...permissionsFrom(job.permissions, location));
      }
    }
  }
  return permissions;
}

export function workflowWritePermissions(source: string): Set<string> {
  const parsed = parseWorkflow(source);
  return new Set(effectiveProtectedPermissions(parsed, false, true));
}

export function explicitWorkflowWritePermissions(source: string): Set<string> {
  const parsed = parseWorkflow(source);
  return new Set(effectiveProtectedPermissions(parsed, false, false));
}

export function workflowTriggers(source: string): Set<string> {
  const on = parseWorkflow(source).on;
  if (typeof on === "string") return new Set([on]);
  if (Array.isArray(on) && on.every((trigger) => typeof trigger === "string")) return new Set(on);
  if (isRecord(on)) return new Set(Object.keys(on));
  throw new Error("workflow on trigger must be a string, array, or mapping");
}

function workflowPrivileges(source: string, conservativeMissing: boolean): Map<string, number> {
  const parsed = parseWorkflow(source);
  const result = new Map<string, number>();
  const permissions = effectiveProtectedPermissions(parsed, true, conservativeMissing);
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

export function workflowAt(cwd: string, sha: string, path: string): string | null {
  if (runGit(cwd, ["cat-file", "-e", `${sha}:${path}`], true) === null) return null;
  return runGit(cwd, ["show", `${sha}:${path}`]);
}

function auditHeadPublishers(cwd: string, headSha: string): void {
  const output = runGit(cwd, ["ls-tree", "-r", "--name-only", "-z", headSha, "--", ".github/workflows"] ) ?? "";
  for (const path of output.split("\0").filter((name) => /\.ya?ml$/.test(name))) {
    const source = workflowAt(cwd, headSha, path);
    if (source === null) throw new Error(`could not read workflow ${path}`);
    const writes = [...explicitWorkflowWritePermissions(source)].sort();
    if (writes.length === 0) continue;
    const triggers = [...workflowTriggers(source)].sort();
    const trustedPublisher = path === ".github/workflows/samorev-gate.yml" &&
      writes.join(",") === "workflow:statuses" && triggers.join(",") === "pull_request_target";
    const trustedClaudeOidc = path === ".github/workflows/claude.yml" &&
      writes.join(",") === "job:id-token" &&
      triggers.join(",") === "issue_comment,issues,pull_request_review,pull_request_review_comment";
    if (!trustedPublisher && !trustedClaudeOidc) {
      throw new Error(`untrusted workflow has protected write authority in ${path}: ${writes.join(", ")}`);
    }
  }
}

function privilegeIsCovered(
  privilege: string,
  count: number,
  basePrivileges: Map<string, number>,
): boolean {
  const [trigger, permission] = privilege.split("|");
  const parts = permission.split(":");
  if (basePrivileges.has(`${trigger}|workflow:write-all`)) return true;
  if (parts[0] === "job" && (
    basePrivileges.has(`${trigger}|workflow:${parts.at(-1)}`) ||
    basePrivileges.has(`${trigger}|job:${parts[1]}:write-all`) ||
    basePrivileges.has(`${trigger}|job:write-all`)
  )) return true;
  return (basePrivileges.get(privilege) ?? 0) >= count;
}

export function checkWorkflowChanges(cwd: string, baseSha: string, headSha: string): void {
  const files = workflowFiles(cwd, baseSha, headSha);
  for (const path of files) {
    const headSource = workflowAt(cwd, headSha, path);
    if (headSource === null) continue;
    const baseSource = workflowAt(cwd, baseSha, path);
    const basePrivileges = baseSource === null ? new Map<string, number>() : workflowPrivileges(baseSource, false);
    const headPrivileges = workflowPrivileges(headSource, true);
    const broadened = [...headPrivileges]
      .filter(([scope, count]) => !privilegeIsCovered(scope, count, basePrivileges))
      .map(([scope]) => scope);
    if (broadened.length > 0) {
      throw new Error(`PR broadens privileged workflow permissions in ${path}: ${broadened.join(", ")}`);
    }
    if (baseSource !== null && explicitWorkflowWritePermissions(headSource).size > 0 && baseSource !== headSource) {
      throw new Error(`PR changes the content of privileged workflow ${path}`);
    }
  }
  auditHeadPublishers(cwd, headSha);
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
