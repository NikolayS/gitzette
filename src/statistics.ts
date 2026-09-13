export const MAX_STATISTICS_REPOSITORIES = 900;

export type Coverage =
  | { status: "complete" }
  | { status: "truncated"; observed: number; limit: number }
  | { status: "unavailable"; reason: string };

export type CountMetric = {
  value: number | null;
  coverage: Coverage;
};

export type SnapshotMetric = CountMetric & {
  observedAt: string;
};

export type RepositoryStatistics = {
  repo: string;
  url: string;
  publicCommits: CountMetric;
  stars: SnapshotMetric;
};

export type ActivityStatistics = {
  period: { from: string; toInclusive: string };
  observedAt: string;
  scopes: {
    releases: "discovered_public_contribution_repositories";
    repositories: "public_repositories_discovered_from_contributions_and_commit_search";
  };
  contributionRepositories: Coverage;
  totals: {
    publicCommits: CountMetric;
    openedPullRequests: CountMetric;
    mergedPullRequests: CountMetric;
    releases: CountMetric;
  };
  repositories: RepositoryStatistics[];
};
export type WeeklyStatistics = ActivityStatistics;

function exact(value: unknown, field: string, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid ${field}`);
  const allowed = new Set(keys);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) throw new Error(`unknown ${field} field: ${unexpected}`);
  const missing = keys.find((key) => !(key in value));
  if (missing) throw new Error(`missing ${field} field: ${missing}`);
}

function natural(value: unknown, field: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`invalid ${field}`);
}

function nonempty(value: unknown, field: string, max: number): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`invalid ${field}`);
}

function isoInstant(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`invalid ${field}`);
  }
  const canonical = new Date(value).toISOString();
  const expected = value.includes(".") ? value : value.replace("Z", ".000Z");
  if (canonical !== expected) throw new Error(`invalid ${field}`);
}

function isoDate(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`invalid ${field}`);
  }
}

function repository(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(value)) throw new Error(`invalid ${field}`);
  if (value.split("/").some((part) => part === "." || part === "..")) throw new Error(`invalid ${field}`);
}

export function validateCoverage(value: unknown, field = "coverage"): Coverage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid ${field}`);
  const status = (value as { status?: unknown }).status;
  if (status === "complete") exact(value, field, ["status"]);
  else if (status === "truncated") {
    exact(value, field, ["status", "observed", "limit"]);
    natural(value.observed, `${field}.observed`);
    natural(value.limit, `${field}.limit`);
    if (value.observed > value.limit) throw new Error(`invalid ${field}`);
  } else if (status === "unavailable") {
    exact(value, field, ["status", "reason"]);
    nonempty(value.reason, `${field}.reason`, 240);
  } else throw new Error(`invalid ${field}`);
  return value as Coverage;
}

function validateCountMetric(value: unknown, field: string): CountMetric {
  exact(value, field, ["value", "coverage"]);
  const coverage = validateCoverage(value.coverage, `${field}.coverage`);
  if (coverage.status === "unavailable") {
    if (value.value !== null) throw new Error(`invalid ${field}.value`);
  } else natural(value.value, `${field}.value`);
  return value as unknown as CountMetric;
}

function githubRepositoryUrl(value: unknown, repo: string): asserts value is string {
  if (value !== `https://github.com/${repo}`) throw new Error("invalid statistics repository URL");
}

export function validateActivityStatistics(value: unknown, weekKey?: string): ActivityStatistics {
  exact(value, "statistics", ["period", "observedAt", "scopes", "contributionRepositories", "totals", "repositories"]);
  exact(value.period, "statistics period", ["from", "toInclusive"]);
  isoDate(value.period.from, "statistics period.from");
  isoDate(value.period.toInclusive, "statistics period.toInclusive");
  if (value.period.from > value.period.toInclusive) throw new Error("invalid statistics period");
  if (weekKey) {
    const { monday, sunday } = parseIsoWeekKey(weekKey);
    if (value.period.from !== monday.toISOString().slice(0, 10)
      || value.period.toInclusive !== sunday.toISOString().slice(0, 10)) {
      throw new Error("statistics period target mismatch");
    }
  }
  isoInstant(value.observedAt, "statistics observedAt");
  exact(value.scopes, "statistics scopes", ["releases", "repositories"]);
  if (value.scopes.releases !== "discovered_public_contribution_repositories"
    || value.scopes.repositories !== "public_repositories_discovered_from_contributions_and_commit_search") throw new Error("invalid statistics scopes");
  validateCoverage(value.contributionRepositories, "statistics contributionRepositories");
  exact(value.totals, "statistics totals", ["publicCommits", "openedPullRequests", "mergedPullRequests", "releases"]);
  validateCountMetric(value.totals.publicCommits, "statistics totals.publicCommits");
  validateCountMetric(value.totals.openedPullRequests, "statistics totals.openedPullRequests");
  validateCountMetric(value.totals.mergedPullRequests, "statistics totals.mergedPullRequests");
  validateCountMetric(value.totals.releases, "statistics totals.releases");
  // Four contribution sources can discover at most 400 repositories, then
  // retained commit-search items can add at most 500 distinct repositories.
  if (!Array.isArray(value.repositories) || value.repositories.length > MAX_STATISTICS_REPOSITORIES) throw new Error("invalid statistics repositories");
  const seen = new Set<string>();
  for (const row of value.repositories) {
    exact(row, "statistics repository", ["repo", "url", "publicCommits", "stars"]);
    repository(row.repo, "statistics repository.repo");
    githubRepositoryUrl(row.url, row.repo);
    if (seen.has(row.repo.toLowerCase())) throw new Error("duplicate statistics repository");
    seen.add(row.repo.toLowerCase());
    validateCountMetric(row.publicCommits, "statistics repository.publicCommits");
    exact(row.stars, "statistics repository.stars", ["value", "coverage", "observedAt"]);
    validateCountMetric({ value: row.stars.value, coverage: row.stars.coverage }, "statistics repository.stars metric");
    isoInstant(row.stars.observedAt, "statistics repository.stars.observedAt");
  }
  return value as unknown as ActivityStatistics;
}

export const validateWeeklyStatistics = validateActivityStatistics;
import { parseIsoWeekKey } from "./week";
