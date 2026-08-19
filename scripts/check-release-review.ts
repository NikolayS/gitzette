export type JsonRecord = Record<string, unknown>;

const reviewerId = 280144521;
const actionsAppId = 15368;
const actionsBotId = 41898282;

export function record(value: unknown, name: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as JsonRecord;
}

export function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}

function pages(value: unknown, name: string): unknown[] {
  const outer = array(value, name);
  return outer.length > 0 && Array.isArray(outer[0]) ? outer.flat() : outer;
}

function checkRuns(value: unknown): JsonRecord[] {
  return array(value, "check run pages").flatMap((page) => {
    const pageRecord = record(page, "check run page");
    return array(pageRecord.check_runs, "check_runs").map((item) => record(item, "check run"));
  });
}

function latestStatus(statuses: unknown[], context: string): JsonRecord {
  const matches = statuses
    .map((item) => record(item, "status"))
    .filter((status) => status.context === context)
    .sort((left, right) => {
      const leftKey = `${String(left.created_at ?? "")}\0${Number(left.id ?? 0).toString().padStart(20, "0")}`;
      const rightKey = `${String(right.created_at ?? "")}\0${Number(right.id ?? 0).toString().padStart(20, "0")}`;
      return leftKey.localeCompare(rightKey);
    });
  if (matches.length === 0) throw new Error(`${context} status is missing`);
  return matches.at(-1)!;
}

export function releaseReview(document: unknown): { reviewedSha: string } {
  const input = record(document, "release review document");
  if (typeof input.release_sha !== "string" || input.release_sha.length === 0) throw new Error("release SHA is missing");
  if (typeof input.main_sha !== "string" || input.main_sha.length === 0) throw new Error("main SHA is missing");
  if (input.release_sha !== input.main_sha) throw new Error("release tag must point to the current main tip");

  const pulls = pages(input.pulls, "pull request pages").map((item) => record(item, "pull request"));
  const merged = pulls.filter((pull) => {
    const base = record(pull.base, "pull request base");
    return base.ref === "main" && pull.merged_at !== null && pull.merge_commit_sha === input.release_sha;
  });
  if (merged.length !== 1) throw new Error("release commit must map to exactly one merged main pull request");
  const head = record(merged[0].head, "pull request head");
  if (typeof head.sha !== "string" || head.sha.length === 0) throw new Error("reviewed pull request SHA is missing");

  const runs = checkRuns(input.check_run_pages);
  for (const name of ["typecheck", "base-controlled samorev publisher"]) {
    const passed = runs.some((check) => {
      const app = record(check.app, "check app");
      return check.name === name && check.conclusion === "success" && app.id === actionsAppId;
    });
    if (!passed) throw new Error(`reviewed head lacks successful ${name}`);
  }

  const statuses = pages(input.status_pages, "status pages");
  const samorev = latestStatus(statuses, "samorev");
  const samorevCreator = record(samorev.creator, "samorev creator");
  if (samorev.state !== "success" || samorevCreator.id !== reviewerId) {
    throw new Error("latest samorev status lacks the immutable successful reviewer identity");
  }
  const gate = latestStatus(statuses, "samorev-gate");
  const gateCreator = record(gate.creator, "samorev-gate creator");
  if (gate.state !== "success" || gateCreator.id !== actionsBotId) {
    throw new Error("latest samorev-gate status lacks the expected Actions identity or success state");
  }
  return { reviewedSha: head.sha };
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) throw new Error("release review document path is required");
  const document = JSON.parse(await Bun.file(path).text());
  process.stdout.write(`${JSON.stringify(releaseReview(document))}\n`);
}
