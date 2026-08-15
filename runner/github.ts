import type { EvidenceBundle, EvidenceItem } from "../src/edition";
import { isGitHubUsername } from "../src/identifiers";
import type { Collector } from "./types";
import { parseIsoWeekKey } from "../src/week";

type RequestFn = typeof fetch;
type SearchItem = {
  id?: number;
  number?: number;
  title?: string;
  html_url?: string;
  sha?: string;
  commit?: { message?: string };
  repository?: { full_name?: string };
};

export class GitHubCollector implements Collector {
  constructor(private readonly token: string, private readonly request: RequestFn = fetch) {}

  async collect(username: string, weekKey: string): Promise<EvidenceBundle> {
    if (!isGitHubUsername(username)) throw new Error("invalid GitHub username");
    const { from, toInclusive } = isoWeek(weekKey);
    const repositories = await this.contributionRepositories(username, from, toInclusive);
    if (repositories.length > 30) throw new Error("GitHub repository set exceeds bounded collector capacity");
    const [commits, mergedPrs, createdPrs, issues, discussions, releases] = await Promise.all([
      this.search("commits", `author:${username} committer-date:${from}..${toInclusive}`),
      this.search("issues", `author:${username} is:pr is:merged merged:${from}..${toInclusive}`),
      this.search("issues", `author:${username} is:pr created:${from}..${toInclusive}`),
      this.search("issues", `author:${username} is:issue created:${from}..${toInclusive}`),
      this.discussions(username, from, toInclusive),
      Promise.all(repositories.map((repo) => this.releases(repo, from, toInclusive))),
    ]);

    const items = new Map<string, EvidenceItem>();
    for (const item of commits) add(items, commitEvidence(item));
    for (const item of [...mergedPrs, ...createdPrs]) add(items, issueEvidence(item, "pull_request"));
    for (const item of issues) add(items, issueEvidence(item, "issue"));
    for (const item of discussions) add(items, item);
    for (const item of releases.flat()) add(items, item);
    for (const repo of repositories) {
      add(items, {
        id: `repository:${repo}`,
        type: "repository",
        title: `Public contributions in ${repo}`,
        url: `https://github.com/${repo}`,
        repo,
      });
    }

    const evidence = [...items.values()].slice(0, 500);
    return { state: evidence.length > 0 ? "active" : "quiet", username, weekKey, items: evidence };
  }

  private async contributionRepositories(username: string, from: string, to: string): Promise<string[]> {
    const query = `query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){contributionsCollection(from:$from,to:$to){commitContributionsByRepository(maxRepositories:100){repository{nameWithOwner}}issueContributions(first:100){nodes{issue{repository{nameWithOwner}}}}pullRequestContributions(first:100){nodes{pullRequest{repository{nameWithOwner}}}}repositoryContributions(first:100){nodes{repository{nameWithOwner}}}}}}`;
    const body = await this.github("https://api.github.com/graphql", {
      method: "POST",
      body: JSON.stringify({ query, variables: { login: username, from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` } }),
    }) as any;
    if (body.errors || !body.data?.user) throw new Error("GitHub contribution collection failed");
    const collection = body.data.user.contributionsCollection;
    const repos = new Set<string>();
    for (const row of collection.commitContributionsByRepository ?? []) repos.add(row.repository.nameWithOwner);
    for (const node of collection.issueContributions?.nodes ?? []) repos.add(node.issue.repository.nameWithOwner);
    for (const node of collection.pullRequestContributions?.nodes ?? []) repos.add(node.pullRequest.repository.nameWithOwner);
    for (const node of collection.repositoryContributions?.nodes ?? []) repos.add(node.repository.nameWithOwner);
    return [...repos].filter(validRepo).sort();
  }

  private async search(kind: "commits" | "issues", query: string): Promise<SearchItem[]> {
    const url = new URL(`https://api.github.com/search/${kind}`);
    url.searchParams.set("q", query);
    url.searchParams.set("sort", kind === "commits" ? "committer-date" : "updated");
    url.searchParams.set("order", "desc");
    url.searchParams.set("per_page", "100");
    const body = await this.github(url.toString()) as { incomplete_results?: boolean; total_count?: number; items?: SearchItem[] };
    if (body.incomplete_results || !Array.isArray(body.items) || (body.total_count ?? 0) > body.items.length) throw new Error(`GitHub ${kind} search incomplete`);
    return body.items;
  }

  private async discussions(username: string, from: string, to: string): Promise<EvidenceItem[]> {
    const query = `query($q:String!){search(query:$q,type:DISCUSSION,first:100){discussionCount nodes{... on Discussion{id title url repository{nameWithOwner}}}}}`;
    const body = await this.github("https://api.github.com/graphql", {
      method: "POST", body: JSON.stringify({ query, variables: { q: `author:${username} created:${from}..${to}` } }),
    }) as any;
    const search = body.data?.search;
    if (body.errors || !search || search.discussionCount > search.nodes.length) throw new Error("GitHub discussion search incomplete");
    return search.nodes.map((node: any) => ({
      id: `discussion:${node.id}`,
      type: "discussion" as const,
      title: String(node.title).slice(0, 500),
      url: String(node.url),
      repo: String(node.repository.nameWithOwner),
    })).filter((item: EvidenceItem) => isGitHubUrl(item.url) && validRepo(item.repo));
  }

  private async releases(repo: string, from: string, to: string): Promise<EvidenceItem[]> {
    const response = await this.github(`https://api.github.com/repos/${repo}/releases?per_page=100`) as any[];
    if (!Array.isArray(response)) throw new Error("GitHub releases response invalid");
    const inRange = response.filter((release) => {
      const date = String(release.published_at ?? release.created_at ?? "").slice(0, 10);
      return date >= from && date <= to;
    });
    if (response.length === 100) {
      const oldest = String(response.at(-1)?.published_at ?? response.at(-1)?.created_at ?? "").slice(0, 10);
      if (oldest >= from) throw new Error(`GitHub releases incomplete for ${repo}`);
    }
    return inRange.map((release) => ({
      id: `release:${repo}:${release.id}`,
      type: "release" as const,
      title: String(release.name ?? release.tag_name ?? "Release").slice(0, 500),
      url: String(release.html_url),
      repo,
    })).filter((item) => isGitHubUrl(item.url));
  }

  private async github(url: string, init: RequestInit = {}): Promise<unknown> {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "api.github.com") throw new Error("forbidden GitHub endpoint");
    const headers = new Headers(init.headers);
    headers.set("accept", "application/vnd.github+json");
    headers.set("authorization", `Bearer ${this.token}`);
    headers.set("content-type", "application/json");
    headers.set("user-agent", "gitzette-oauth-runner/1");
    headers.set("x-github-api-version", "2022-11-28");
    const response = await this.request(parsed, { ...init, headers, redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`GitHub ${parsed.pathname} returned ${response.status}`);
    const text = await response.text();
    if (text.length > 5_000_000) throw new Error("GitHub response too large");
    return JSON.parse(text);
  }
}

function add(items: Map<string, EvidenceItem>, item: EvidenceItem | null): void {
  if (item) items.set(item.id, item);
}

function commitEvidence(item: SearchItem): EvidenceItem | null {
  const repo = item.repository?.full_name;
  if (!item.sha || !repo || !validRepo(repo) || !isGitHubUrl(item.html_url)) return null;
  return {
    id: `commit:${item.sha}`,
    type: "commit",
    title: firstLine(item.commit?.message ?? "Commit").slice(0, 500),
    url: item.html_url!,
    repo,
  };
}

function issueEvidence(item: SearchItem, type: "pull_request" | "issue"): EvidenceItem | null {
  if (!item.id || !item.number || !item.title || !isGitHubUrl(item.html_url)) return null;
  const parsed = new URL(item.html_url!);
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 4) return null;
  const repo = `${parts[0]}/${parts[1]}`;
  if (!validRepo(repo)) return null;
  return { id: `${type}:${repo}#${item.number}`, type, title: item.title.slice(0, 500), url: item.html_url!, repo };
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0].trim() || "Commit";
}

function isGitHubUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" && !url.username && !url.password;
  } catch { return false; }
}

function validRepo(value: string): boolean {
  return /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(value);
}

export function isoWeek(weekKey: string): { from: string; toExclusive: string; toInclusive: string } {
  const { monday, nextMonday, sunday } = parseIsoWeekKey(weekKey);
  const date = (value: Date) => value.toISOString().slice(0, 10);
  return { from: date(monday), toExclusive: date(nextMonday), toInclusive: date(sunday) };
}
