import type { ActivityStatistics, CountMetric, RepositoryStatistics } from "./statistics";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function renderCount(metric: CountMetric): { value: string; note: string } {
  if (metric.coverage.status === "unavailable" || metric.value === null) return { value: "—", note: "not available" };
  if (metric.coverage.status === "truncated") return { value: `≥${formatNumber(metric.value)}`, note: "partial count" };
  return { value: formatNumber(metric.value), note: "" };
}

function formatObservedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
    timeZone: "UTC", timeZoneName: "short",
  });
}

function safeRepositoryUrl(repository: RepositoryStatistics): string | undefined {
  try {
    const url = new URL(repository.url);
    const expectedPath = `/${repository.repo}`.toLowerCase();
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password
      || url.search || url.hash || url.pathname.replace(/\/$/, "").toLowerCase() !== expectedPath) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

const TOTALS: readonly [keyof ActivityStatistics["totals"], string][] = [
  ["publicCommits", "public commits"],
  ["openedPullRequests", "PRs opened"],
  ["mergedPullRequests", "PRs merged"],
  ["releases", "releases"],
];

/** Compact activity facts for the black strip beneath an edition header. */
export function renderStatisticsBar(statistics: ActivityStatistics): string {
  return TOTALS.map(([key, label]) => {
    const count = renderCount(statistics.totals[key]);
    return `<span><strong>${escapeHtml(count.value)}</strong> ${label}${count.note ? ` <small>(${count.note})</small>` : ""}</span>`;
  }).join("");
}

// Retained as a descriptive alias for callers that treat the bar as a summary strip.
export const renderStatisticsSummaryStrip = renderStatisticsBar;

function renderMetric(metric: CountMetric, label: string): string {
  const count = renderCount(metric);
  return `<div class="dispatch-metric"><strong>${escapeHtml(count.value)}</strong><span>${label}</span>${count.note ? `<small>${count.note}</small>` : ""}</div>`;
}

function coverageNote(statistics: ActivityStatistics): string {
  const coverage = statistics.contributionRepositories;
  if (coverage.status === "complete") return "Counts cover the public activity collected for this week.";
  if (coverage.status === "truncated") return `Partial repository coverage: ${formatNumber(coverage.observed)} observed (collection limit ${formatNumber(coverage.limit)}). Counts marked ≥ are lower bounds.`;
  return `Repository coverage unavailable: ${coverage.reason}`;
}

/** Render the newspaper statistics rail. All externally supplied text is escaped. */
export function renderStatisticsSidebar(statistics: ActivityStatistics): string {
  const commitRows = statistics.repositories
    .filter((repository) => repository.publicCommits.value !== null)
    .sort((a, b) => (b.publicCommits.value ?? 0) - (a.publicCommits.value ?? 0) || a.repo.localeCompare(b.repo));
  const maxCommits = Math.max(1, ...commitRows.map((repository) => repository.publicCommits.value ?? 0));
  const commits = commitRows.length
    ? commitRows.map((repository) => {
      const count = renderCount(repository.publicCommits);
      const value = repository.publicCommits.value ?? 0;
      const width = value === 0 ? 0 : Math.max(2, Math.round(value / maxCommits * 100));
      return `<div class="dispatch-repo"><div class="dispatch-repo-label"><span>${escapeHtml(repository.repo)}</span><strong>${escapeHtml(count.value)}</strong></div><div class="dispatch-repo-track" aria-hidden="true"><div class="dispatch-repo-fill" style="width:${width}%"></div></div>${count.note ? `<small>${count.note}</small>` : ""}</div>`;
    }).join("")
    : '<p class="dispatch-empty">No repository-level commit counts are available.</p>';

  const stars = statistics.repositories
    .filter((repository) => repository.stars.value !== null)
    .sort((a, b) => (b.stars.value ?? 0) - (a.stars.value ?? 0) || a.repo.localeCompare(b.repo));
  const maxStars = Math.max(1, ...stars.map((repository) => repository.stars.value ?? 0));
  const starRows = stars.length
    ? stars.map((repository) => {
      const url = safeRepositoryUrl(repository);
      const label = escapeHtml(repository.repo);
      const repositoryLabel = url ? `<a rel="noopener noreferrer" href="${escapeHtml(url)}">${label}</a>` : label;
      const value = repository.stars.value ?? 0;
      const count = renderCount(repository.stars);
      const width = Math.round(value / maxStars * 100);
      const observed = repository.stars.observedAt === statistics.observedAt ? "" : `<small>Observed <time datetime="${escapeHtml(repository.stars.observedAt)}">${escapeHtml(formatObservedAt(repository.stars.observedAt))}</time></small>`;
      return `<tr><th scope="row">${repositoryLabel}</th><td><span class="dispatch-star-count">${escapeHtml(count.value)}</span><span class="dispatch-star-bar" aria-hidden="true"><i style="width:${width}%"></i></span>${count.note ? `<small>${count.note}</small>` : ""}${observed}</td></tr>`;
    }).join("")
    : '<tr><td colspan="2" class="dispatch-empty">No star snapshots are available.</td></tr>';

  const metrics = TOTALS.map(([key, label]) => renderMetric(statistics.totals[key], label)).join("");
  const observed = formatObservedAt(statistics.observedAt);
  return `<aside class="dispatch-sidebar" aria-label="Weekly GitHub activity statistics"><h2>Weekly activity</h2><div class="dispatch-metrics">${metrics}</div><h2>Public commits by repository</h2>${commits}<h2 class="dispatch-stars-heading">Repository stars <span>current snapshot</span></h2><table class="dispatch-stars"><tbody>${starRows}</tbody></table><p class="dispatch-sidebar-note">${escapeHtml(coverageNote(statistics))} Release counts cover discovered public contribution repositories, not only releases authored by the profile owner.</p><p class="dispatch-sidebar-note">Star totals are current snapshots, not values from the edition week. Observed <time datetime="${escapeHtml(statistics.observedAt)}">${escapeHtml(observed)}</time>.</p></aside>`;
}
