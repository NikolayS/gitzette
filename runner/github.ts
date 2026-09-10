import type { EvidenceBundle, EvidenceItem } from "../src/edition";
import { normalizeGitHubUsername } from "../src/identifiers";
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
    const canonicalUsername = normalizeGitHubUsername(username);
    if (!canonicalUsername) throw new Error("invalid GitHub username");
    const { from, toInclusive } = isoWeek(weekKey);
    const repositories = await this.contributionRepositories(canonicalUsername, from, toInclusive);
    const [commits, mergedPrs, createdPrs, issues, discussions, releases] = await Promise.all([
      this.search("commits", `author:${canonicalUsername} committer-date:${from}..${toInclusive}`),
      this.search("issues", `author:${canonicalUsername} is:pr is:merged merged:${from}..${toInclusive}`),
      this.search("issues", `author:${canonicalUsername} is:pr created:${from}..${toInclusive}`),
      this.search("issues", `author:${canonicalUsername} is:issue created:${from}..${toInclusive}`),
      this.discussions(canonicalUsername, from, toInclusive),
      mapConcurrent(repositories, 5, (repo) => this.releases(repo, from, toInclusive)),
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
    return { state: evidence.length > 0 ? "active" : "quiet", username: canonicalUsername, weekKey, items: evidence };
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

  private async search(kind: "commits" | "issues", query: string, splitIncomplete = true): Promise<SearchItem[]> {
    const items: SearchItem[] = [];
    for (let page = 1; page <= 5; page++) {
      const url = new URL(`https://api.github.com/search/${kind}`);
      url.searchParams.set("q", query);
      url.searchParams.set("sort", kind === "commits" ? "committer-date" : "updated");
      url.searchParams.set("order", "desc");
      url.searchParams.set("per_page", "100");
      url.searchParams.set("page", String(page));
      const body = await this.github(url.toString()) as { incomplete_results?: boolean; total_count?: number; items?: SearchItem[] };
      if (!Array.isArray(body.items)) throw new Error(`GitHub ${kind} search incomplete`);
      if (body.incomplete_results) {
        // A global historical search can time out even below the result cap.
        // Retry once as sequential daily windows; never accept partial data.
        const range = query.match(/(?:committer-date|merged|created):(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/);
        if (!splitIncomplete || !range) throw new Error(`GitHub ${kind} search incomplete`);
        const start = Date.parse(range[1] + "T00:00:00Z");
        const end = Date.parse(range[2] + "T00:00:00Z");
        const days = (end - start) / 86400000 + 1;
        if (!Number.isInteger(days) || days < 1 || days > 7) throw new Error("invalid bounded search window");
        const complete: SearchItem[] = [];
        for (let day = 0; day < days; day++) {
          const date = new Date(start + day * 86400000).toISOString().slice(0, 10);
          complete.push(...await this.search(kind, query.replace(range[0], range[0].split(":")[0] + ":" + date + ".." + date), false));
        }
        return complete.slice(0, 500);
      }
      items.push(...body.items);
      if (body.items.length < 100 || items.length >= Math.min(body.total_count ?? items.length, 500)) break;
    }
    return items.slice(0, 500);
  }

  private async discussions(username: string, from: string, to: string): Promise<EvidenceItem[]> {
    const query = `query($q:String!,$cursor:String){search(query:$q,type:DISCUSSION,first:100,after:$cursor){discussionCount pageInfo{hasNextPage endCursor} nodes{... on Discussion{id title url repository{nameWithOwner}}}}}`;
    const nodes: any[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const body = await this.github("https://api.github.com/graphql", {
        method: "POST", body: JSON.stringify({ query, variables: { q: `author:${username} created:${from}..${to}`, cursor } }),
      }) as any;
      const search = body.data?.search;
      if (body.errors || !search || !Array.isArray(search.nodes)) throw new Error("GitHub discussion search incomplete");
      nodes.push(...search.nodes);
      if (!search.pageInfo?.hasNextPage || nodes.length >= 500) break;
      if (typeof search.pageInfo.endCursor !== "string") throw new Error("GitHub discussion cursor missing");
      cursor = search.pageInfo.endCursor;
    }
    return nodes.slice(0, 500).map((node: any) => ({
      id: `discussion:${node.id}`,
      type: "discussion" as const,
      title: String(node.title).slice(0, 500),
      url: String(node.url),
      repo: String(node.repository.nameWithOwner),
    })).filter((item: EvidenceItem) => isGitHubUrl(item.url) && validRepo(item.repo));
  }

  private async releases(repo: string, from: string, to: string): Promise<EvidenceItem[]> {
    const response: any[] = [];
    const encodedRepo = repo.split("/").map(encodeURIComponent).join("/");
    for (let page = 1; page <= 5; page++) {
      const batch = await this.github(`https://api.github.com/repos/${encodedRepo}/releases?per_page=100&page=${page}`) as any[];
      if (!Array.isArray(batch)) throw new Error("GitHub releases response invalid");
      response.push(...batch);
      const oldest = String(batch.at(-1)?.published_at ?? batch.at(-1)?.created_at ?? "").slice(0, 10);
      if (batch.length < 100 || oldest < from) break;
    }
    return response.filter((release) => {
      const date = String(release.published_at ?? release.created_at ?? "").slice(0, 10);
      return date >= from && date <= to;
    }).map((release) => ({
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
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(value)) return false;
  return value.split("/").every((segment) => segment !== "." && segment !== "..");
}

async function mapConcurrent<T, R>(items: readonly T[], limit: number, operation: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await operation(items[index]);
    }
  }));
  return results;
}

export function isoWeek(weekKey: string): { from: string; toExclusive: string; toInclusive: string } {
  const { monday, nextMonday, sunday } = parseIsoWeekKey(weekKey);
  const date = (value: Date) => value.toISOString().slice(0, 10);
  return { from: date(monday), toExclusive: date(nextMonday), toInclusive: date(sunday) };
}
