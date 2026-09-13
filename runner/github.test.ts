import { describe, expect, test } from "bun:test";
import { GitHubCollector, isoWeek, selectEvidence } from "./github";
import { MAX_STATISTICS_REPOSITORIES, validateActivityStatistics } from "../src/statistics";

function emptyContributions(overrides: Record<string, unknown> = {}) {
  return {
    commitContributionsByRepository: [],
    issueContributions: { nodes: [], pageInfo: { hasNextPage: false } },
    pullRequestContributions: { nodes: [], pageInfo: { hasNextPage: false } },
    repositoryContributions: { nodes: [], pageInfo: { hasNextPage: false } },
    ...overrides,
  };
}

function emptyDiscussionSearch() {
  return { discussionCount: 0, nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
}

describe("canonical GitHub collector", () => {
  test("computes exact ISO-week boundaries", () => {
    expect(isoWeek("2026-W01")).toEqual({ from: "2025-12-29", toExclusive: "2026-01-05", toInclusive: "2026-01-04" });
    expect(isoWeek("2026-W32")).toEqual({ from: "2026-08-03", toExclusive: "2026-08-10", toInclusive: "2026-08-09" });
    expect(() => isoWeek("2027-W53")).toThrow("does not exist");
  });

  test("selects evidence fairly by category and repository while preserving bucket order", () => {
    const item = (id: string, type: "commit" | "pull_request" | "release", repo: string) => ({
      id, type, repo, title: id, url: `https://github.com/${repo}/commit/${id}`,
    });
    const selected = selectEvidence([
      item("a1", "commit", "octocat/a"), item("a2", "commit", "octocat/a"),
      item("b1", "commit", "octocat/b"), item("pr1", "pull_request", "octocat/a"),
      item("rel1", "release", "octocat/a"),
    ], 5);
    expect(selected.map((entry) => entry.id)).toEqual(["a1", "pr1", "rel1", "b1", "a2"]);
  });

  test("uses only api.github.com and freezes returned evidence", async () => {
    const urls: string[] = [];
    const request = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      if (url === "https://api.github.com/graphql") {
        const requestBody = JSON.parse(String(init?.body ?? "{}"));
        if (requestBody.query?.includes("type:DISCUSSION")) return Response.json({ data: { search: emptyDiscussionSearch() } });
        return Response.json({ data: { user: { contributionsCollection: emptyContributions({
          commitContributionsByRepository: [
            { repository: { visibility: "PUBLIC", nameWithOwner: "octocat/widget", stargazerCount: 17 } },
          ],
        }) } } });
      }
      if (url.includes("/releases?")) return Response.json([]);
      if (url.includes("/search/commits")) return Response.json({ incomplete_results: false, total_count: 1, items: [{ sha: "abc", html_url: "https://github.com/octocat/widget/commit/abc", commit: { message: "Fix parser\nbody" }, repository: { full_name: "octocat/widget" } }] });
      return Response.json({ incomplete_results: false, total_count: 0, items: [] });
    };
    const evidence = await new GitHubCollector("token", request as typeof fetch).collect("OctoCat", "2026-W32");
    expect(urls.every((url) => new URL(url).hostname === "api.github.com")).toBe(true);
    expect(evidence.state).toBe("active");
    expect(evidence.username).toBe("octocat");
    expect(evidence.items.map((item) => item.id)).toEqual(["commit:abc", "repository:octocat/widget"]);
    expect((evidence as any).stats.repositories).toEqual([{
      repo: "octocat/widget", url: "https://github.com/octocat/widget",
      publicCommits: { value: 1, coverage: { status: "complete" } },
      stars: { value: 17, observedAt: (evidence as any).stats.observedAt, coverage: { status: "complete" } },
    }]);
  });

  test("paginates search results instead of failing above one page", async () => {
    const commitPages: number[] = [];
    const request = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://api.github.com/graphql") {
        const requestBody = JSON.parse(String(init?.body ?? "{}"));
        if (requestBody.query?.includes("type:DISCUSSION")) {
          return Response.json({ data: { search: { discussionCount: 0, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } });
        }
        return Response.json({ data: { user: { contributionsCollection: emptyContributions() } } });
      }
      const parsed = new URL(url);
      if (parsed.pathname === "/search/commits") {
        const page = Number(parsed.searchParams.get("page"));
        commitPages.push(page);
        const count = page === 1 ? 100 : 1;
        return Response.json({
          incomplete_results: false,
          total_count: 101,
          items: Array.from({ length: count }, (_, index) => {
            const id = (page - 1) * 100 + index;
            return { sha: `sha${id}`, html_url: `https://github.com/octocat/widget/commit/sha${id}`, commit: { message: `Commit ${id}` }, repository: { full_name: "octocat/widget" } };
          }),
        });
      }
      return Response.json({ incomplete_results: false, total_count: 0, items: [] });
    };
    const evidence = await new GitHubCollector("token", request as typeof fetch).collect("octocat", "2026-W32");
    expect(commitPages).toEqual([1, 2]);
    expect(evidence.items).toHaveLength(101);
  });

  test("retains PR and release evidence beside 500 commits without changing statistics", async () => {
    const request = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/graphql") {
        const body = JSON.parse(String(init?.body));
        if (body.query.includes("type:DISCUSSION")) return Response.json({ data: { search: emptyDiscussionSearch() } });
        return Response.json({ data: { user: { contributionsCollection: emptyContributions({
          commitContributionsByRepository: [{ repository: { nameWithOwner: "octocat/widget", visibility: "PUBLIC", stargazerCount: 10 } }],
        }) } } });
      }
      if (url.pathname === "/search/commits") {
        const page = Number(url.searchParams.get("page"));
        return Response.json({
          incomplete_results: false, total_count: 500,
          items: Array.from({ length: 100 }, (_, offset) => {
            const id = (page - 1) * 100 + offset;
            return {
              sha: `sha-${id}`, html_url: `https://github.com/octocat/widget/commit/sha-${id}`,
              commit: { message: `Commit ${id}`, committer: { date: new Date(Date.UTC(2026, 7, 3, 0, id)).toISOString() } },
              repository: { full_name: "octocat/widget", private: false },
            };
          }),
        });
      }
      if (url.pathname === "/search/issues") {
        const query = url.searchParams.get("q")!;
        if (query.includes("is:pr") && query.includes("created:")) return Response.json({
          incomplete_results: false, total_count: 1,
          items: [{ id: 7, number: 7, title: "Important PR", html_url: "https://github.com/octocat/widget/pull/7" }],
        });
        return Response.json({ incomplete_results: false, total_count: 0, items: [] });
      }
      if (url.pathname === "/repos/octocat/widget/releases") return Response.json([{
        id: 9, draft: false, published_at: "2026-08-06T00:00:00Z",
        html_url: "https://github.com/octocat/widget/releases/tag/v9", name: "v9",
      }]);
      throw new Error(`unexpected URL ${url}`);
    };
    const result = await new GitHubCollector("token", request as typeof fetch).collect("octocat", "2026-W32") as any;
    expect(result.items).toHaveLength(500);
    expect(result.items.slice(0, 4).map((item: any) => item.type)).toEqual(["commit", "pull_request", "release", "repository"]);
    expect(result.items.some((item: any) => item.id === "pull_request:octocat/widget#7")).toBe(true);
    expect(result.items.some((item: any) => item.id === "release:octocat/widget:9")).toBe(true);
    expect(result.stats.totals.publicCommits.value).toBe(500);
    expect(result.stats.totals.openedPullRequests.value).toBe(1);
    expect(result.stats.totals.releases.value).toBe(1);
  });

  test("deduplicates shifting commit search pages without changing the exact aggregate", async () => {
    const request = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/graphql") {
        const body = JSON.parse(String(init?.body));
        return Response.json(body.query.includes("type:DISCUSSION")
          ? { data: { search: emptyDiscussionSearch() } }
          : { data: { user: { contributionsCollection: emptyContributions() } } });
      }
      if (url.pathname !== "/search/commits") return Response.json({ incomplete_results: false, total_count: 0, items: [] });
      const page = Number(url.searchParams.get("page"));
      const item = (id: number) => ({
        sha: `sha-${id}`, html_url: `https://github.com/octocat/widget/commit/sha-${id}`,
        commit: { message: `Commit ${id}`, committer: { date: `2026-08-05T00:${String(id % 60).padStart(2, "0")}:00Z` } },
        repository: { full_name: "octocat/widget" },
      });
      return Response.json({
        incomplete_results: false, total_count: 101,
        items: page === 1 ? Array.from({ length: 100 }, (_, id) => item(id)) : [item(99)],
      });
    };
    const result = await new GitHubCollector("token", request as typeof fetch).collect("octocat", "2026-W32") as any;
    expect(result.stats.totals.publicCommits).toEqual({ value: 101, coverage: { status: "complete" } });
    expect(result.stats.repositories[0].publicCommits).toEqual({
      value: 100, coverage: { status: "truncated", observed: 100, limit: 500 },
    });
    expect(result.items.filter((item: any) => item.type === "commit")).toHaveLength(100);
  });

  test("fails closed on changing totals and when unique search items exceed a stable total", async () => {
    for (const { secondPageTotal, error } of [
      { secondPageTotal: 102, error: "GitHub commits search total changed during pagination" },
      { secondPageTotal: 100, error: "GitHub commits search total changed during pagination" },
      { secondPageTotal: 101, error: "GitHub commits search items exceed total" },
    ]) {
      const request = async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === "/graphql") {
          const body = JSON.parse(String(init?.body));
          return Response.json(body.query.includes("type:DISCUSSION")
            ? { data: { search: emptyDiscussionSearch() } }
            : { data: { user: { contributionsCollection: emptyContributions() } } });
        }
        if (url.pathname !== "/search/commits") return Response.json({ incomplete_results: false, total_count: 0, items: [] });
        const page = Number(url.searchParams.get("page"));
        const start = page === 1 ? 0 : 100;
        const count = page === 1 ? 100 : 2;
        return Response.json({
          incomplete_results: false,
          total_count: page === 1 ? 101 : secondPageTotal,
          items: Array.from({ length: count }, (_, offset) => ({
            sha: `sha-${start + offset}`,
            html_url: `https://github.com/octocat/widget/commit/sha-${start + offset}`,
            commit: { message: `Commit ${start + offset}` },
            repository: { full_name: "octocat/widget" },
          })),
        });
      };
      await expect(new GitHubCollector("token", request as unknown as typeof fetch).collect("octocat", "2026-W32"))
        .rejects.toThrow(error);
    }
  });

  test("requires explicit totals and valid public search items before certifying statistics", async () => {
    const validCommit = {
      sha: "abc", html_url: "https://github.com/octocat/widget/commit/abc",
      commit: { message: "Change" }, repository: { full_name: "octocat/widget", private: false },
    };
    const validPr = { id: 1, number: 1, title: "PR", html_url: "https://github.com/octocat/widget/pull/1" };
    const cases = [
      { path: "/search/commits", response: { incomplete_results: false, items: [] }, error: "GitHub commits search total missing" },
      { path: "/search/commits", response: { total_count: 0, items: [] }, error: "GitHub commits search incomplete_results invalid" },
      { path: "/search/commits", response: { incomplete_results: null, total_count: 0, items: [] }, error: "GitHub commits search incomplete_results invalid" },
      { path: "/search/commits", response: { incomplete_results: "false", total_count: 0, items: [] }, error: "GitHub commits search incomplete_results invalid" },
      { path: "/search/commits", response: { incomplete_results: false, total_count: 1, items: [] }, error: "GitHub commits search total has no items" },
      { path: "/search/commits", response: { incomplete_results: false, total_count: 1, items: [{ ...validCommit, sha: undefined }] }, error: "GitHub commits search item invalid" },
      { path: "/search/commits", response: { incomplete_results: false, total_count: 1, items: [{ ...validCommit, repository: { full_name: "octocat/widget", private: true } }] }, error: "GitHub commits search item invalid" },
      { path: "/search/commits", response: { incomplete_results: false, total_count: 1, items: [{ ...validCommit, repository: {} }] }, error: "GitHub commits search item invalid" },
      { path: "/search/commits", response: { incomplete_results: false, total_count: 1, items: [{ ...validCommit, html_url: undefined }] }, error: "GitHub commits search item invalid" },
      { path: "/search/issues", response: { incomplete_results: false, total_count: 1, items: [{ ...validPr, id: undefined }] }, error: "GitHub issues search item invalid" },
    ];
    for (const testCase of cases) {
      const request = async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === "/graphql") {
          const body = JSON.parse(String(init?.body));
          return Response.json(body.query.includes("type:DISCUSSION")
            ? { data: { search: emptyDiscussionSearch() } }
            : { data: { user: { contributionsCollection: emptyContributions() } } });
        }
        if (url.pathname === testCase.path) return Response.json(testCase.response);
        return Response.json({ incomplete_results: false, total_count: 0, items: [] });
      };
      await expect(new GitHubCollector("token", request as unknown as typeof fetch).collect("octocat", "2026-W32"))
        .rejects.toThrow(testCase.error);
    }
  });

  test("paginates discussion evidence with GraphQL cursors", async () => {
    const cursors: Array<string | null> = [];
    const request = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://api.github.com/graphql") {
        const requestBody = JSON.parse(String(init?.body ?? "{}"));
        if (requestBody.query?.includes("type:DISCUSSION")) {
          const cursor = requestBody.variables.cursor as string | null;
          cursors.push(cursor);
          const start = cursor ? 100 : 0;
          const count = cursor ? 1 : 100;
          return Response.json({ data: { search: {
            discussionCount: 101,
            pageInfo: { hasNextPage: !cursor, endCursor: cursor ? null : "page-2" },
            nodes: Array.from({ length: count }, (_, index) => ({
              id: `D${start + index}`,
              title: `Discussion ${start + index}`,
              url: `https://github.com/octocat/widget/discussions/${start + index}`,
              repository: { visibility: "PUBLIC", nameWithOwner: "octocat/widget" },
            })),
          } } });
        }
        return Response.json({ data: { user: { contributionsCollection: emptyContributions() } } });
      }
      return Response.json({ incomplete_results: false, total_count: 0, items: [] });
    };
    const evidence = await new GitHubCollector("token", request as typeof fetch).collect("octocat", "2026-W32");
    expect(cursors).toEqual([null, "page-2"]);
    expect(evidence.items).toHaveLength(101);
  });

  test("rejects malformed contribution and discussion completeness envelopes", async () => {
    const malformedCollections = [
      { ...emptyContributions(), commitContributionsByRepository: undefined },
      { ...emptyContributions(), issueContributions: { nodes: [] } },
      { ...emptyContributions(), pullRequestContributions: { nodes: null, pageInfo: { hasNextPage: false } } },
      { ...emptyContributions(), repositoryContributions: { nodes: [], pageInfo: { hasNextPage: "false" } } },
    ];
    for (const collection of malformedCollections) {
      const request = async () => Response.json({ data: { user: { contributionsCollection: collection } } });
      await expect(new GitHubCollector("token", request as unknown as typeof fetch).collect("octocat", "2026-W32"))
        .rejects.toThrow(/contribution (repositories|connection) invalid/);
    }

    const discussionCases = [
      { discussionCount: 0, nodes: [], pageInfo: { endCursor: null } },
      { discussionCount: 1, nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
    ];
    for (const search of discussionCases) {
      const request = async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === "/graphql") {
          const body = JSON.parse(String(init?.body));
          return Response.json(body.query.includes("type:DISCUSSION")
            ? { data: { search } }
            : { data: { user: { contributionsCollection: emptyContributions() } } });
        }
        return Response.json({ incomplete_results: false, total_count: 0, items: [] });
      };
      await expect(new GitHubCollector("token", request as typeof fetch).collect("octocat", "2026-W32"))
        .rejects.toThrow(/discussion search (pagination invalid|count does not match items)/);
    }
  });

  test("deduplicates discussion IDs and rejects an exhausted count they cannot satisfy", async () => {
    const node = {
      id: "D1", title: "Repeated", url: "https://github.com/octocat/widget/discussions/1",
      repository: { nameWithOwner: "octocat/widget", visibility: "PUBLIC" },
    };
    const request = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/graphql") {
        const body = JSON.parse(String(init?.body));
        if (!body.query.includes("type:DISCUSSION")) return Response.json({ data: { user: { contributionsCollection: emptyContributions() } } });
        const second = body.variables.cursor === "next";
        return Response.json({ data: { search: {
          discussionCount: 2, nodes: [node],
          pageInfo: { hasNextPage: !second, endCursor: second ? null : "next" },
        } } });
      }
      return Response.json({ incomplete_results: false, total_count: 0, items: [] });
    };
    await expect(new GitHubCollector("token", request as typeof fetch).collect("octocat", "2026-W32"))
      .rejects.toThrow("GitHub discussion search count does not match items");
  });

  test("accepts matching organization discussions, rejects mismatched organizations, and fails at an unexhausted cap", async () => {
    const collectDiscussion = (searchForPage: (cursor: string | null) => unknown) => {
      const request = async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === "/graphql") {
          const body = JSON.parse(String(init?.body));
          return Response.json(body.query.includes("type:DISCUSSION")
            ? { data: { search: searchForPage(body.variables.cursor) } }
            : { data: { user: { contributionsCollection: emptyContributions() } } });
        }
        return Response.json({ incomplete_results: false, total_count: 0, items: [] });
      };
      return new GitHubCollector("token", request as typeof fetch).collect("octocat", "2026-W32");
    };
    const orgNode = {
      id: "D-org", title: "Organization topic", url: "https://github.com/orgs/octocat/discussions/7",
      repository: { nameWithOwner: "octocat/widget", visibility: "PUBLIC" },
    };
    const accepted = await collectDiscussion(() => ({
      discussionCount: 1, nodes: [orgNode], pageInfo: { hasNextPage: false, endCursor: null },
    }));
    expect(accepted.items.some((item) => item.id === "discussion:D-org")).toBe(true);
    await expect(collectDiscussion(() => ({
      discussionCount: 1, nodes: [{ ...orgNode, url: "https://github.com/orgs/other/discussions/7" }],
      pageInfo: { hasNextPage: false, endCursor: null },
    }))).rejects.toThrow("GitHub discussion search item invalid");

    await expect(collectDiscussion((cursor) => {
      const page = cursor ? Number(cursor.slice(1)) : 0;
      return {
        discussionCount: 501,
        nodes: Array.from({ length: 100 }, (_, index) => ({
          id: `D-${page}-${index}`, title: `Discussion ${page}-${index}`,
          url: `https://github.com/octocat/widget/discussions/${page * 100 + index + 1}`,
          repository: { nameWithOwner: "octocat/widget", visibility: "PUBLIC" },
        })),
        pageInfo: { hasNextPage: true, endCursor: `p${page + 1}` },
      };
    })).rejects.toThrow("GitHub discussion search exceeded collection cap");
  });
});


test("incomplete weekly searches use bounded daily windows and still fail closed", async () => {
  for (const failDaily of [false, true]) {
    const commitQueries: string[] = [];
    const request = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/graphql") {
        const body = JSON.parse(String(init?.body));
        if (body.query.includes("type:DISCUSSION")) return Response.json({ data: { search: emptyDiscussionSearch() } });
        return Response.json({ data: { user: { contributionsCollection: emptyContributions() } } });
      }
      if (url.pathname !== "/search/commits") return Response.json({ items: [], incomplete_results: false, total_count: 0 });
      const q = url.searchParams.get("q")!;
      commitQueries.push(q);
      const weekly = q.includes("2026-08-03..2026-08-09");
      return Response.json({ incomplete_results: weekly || failDaily, total_count: weekly ? 0 : 1, items: weekly ? [] : [{
        sha: q, html_url: "https://github.com/octocat/widget/commit/abc",
        commit: { message: "Daily change" }, repository: { full_name: "octocat/widget" },
      }] });
    };
    const collected = new GitHubCollector("test-token", request as typeof fetch).collect("octocat", "2026-W32");
    if (failDaily) {
      await expect(collected).rejects.toThrow("GitHub commits search incomplete");
      expect(commitQueries).toHaveLength(2);
    } else {
      expect((await collected).items).toHaveLength(7);
      expect(commitQueries).toHaveLength(8);
      expect(commitQueries[1]).toContain("2026-08-03..2026-08-03");
      expect(commitQueries[7]).toContain("2026-08-09..2026-08-09");
    }
  }
});

test('daily fallback deduplicates and selects newest weekly commits after merging over 500 results', async()=>{
 const request=async(input:string|URL|Request,init?:RequestInit)=>{
  const url=new URL(String(input));
  if(url.pathname==='/graphql') {
   const body=JSON.parse(String(init?.body));
   return Response.json(body.query.includes('type:DISCUSSION')?{data:{search:emptyDiscussionSearch()}}:{data:{user:{contributionsCollection:emptyContributions()}}});
  }
  if(url.pathname!=='/search/commits')return Response.json({items:[],incomplete_results:false,total_count:0});
  const q=url.searchParams.get('q')!;
  if(q.includes('2026-08-03..2026-08-09'))return Response.json({items:[],incomplete_results:true,total_count:0});
  const date=q.match(/committer-date:(\d{4}-\d{2}-\d{2})/)![1];
  return Response.json({incomplete_results:false,total_count:100,items:Array.from({length:100},(_,i)=>({sha:i===0?'common':`${date}-${i}`,html_url:`https://github.com/octocat/widget/commit/${i}`,repository:{full_name:'octocat/widget'},commit:{message:`Change ${i}`,committer:{date:new Date(Date.parse(date+'T00:00:00Z')+i*60000).toISOString()}}}))});
 };
 const result=await new GitHubCollector('test-token',request as typeof fetch).collect('octocat','2026-W32');
 expect(result.items).toHaveLength(500);
 expect((result as any).stats.totals.publicCommits).toEqual({value:700,coverage:{status:'complete'}});
 expect((result as any).stats.repositories[0].publicCommits.coverage.status).toBe('truncated');
 expect(result.items[0].id).toBe('commit:2026-08-09-99');
 expect(result.items.filter(x=>x.id==='commit:common')).toHaveLength(1);
 expect(result.items.some(x=>x.id.startsWith('commit:2026-08-03-'))).toBe(false);
});

test("keeps opened and merged PR event totals distinct, including the same PR", async () => {
  const queries: string[] = [];
  const request = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/graphql") {
      const body = JSON.parse(String(init?.body));
      return Response.json(body.query.includes("type:DISCUSSION")
        ? { data: { search: emptyDiscussionSearch() } }
        : { data: { user: { contributionsCollection: emptyContributions() } } });
    }
    if (url.pathname !== "/search/issues") return Response.json({ incomplete_results: false, total_count: 0, items: [] });
    const query = url.searchParams.get("q")!;
    queries.push(query);
    if (!query.includes("is:pr")) return Response.json({ incomplete_results: false, total_count: 0, items: [] });
    return Response.json({ incomplete_results: false, total_count: 1, items: [{
      id: 42, number: 7, title: "Opened and merged", updated_at: "2026-08-05T00:00:00Z",
      html_url: "https://github.com/OctoCat/Widget/pull/7",
    }] });
  };
  const result = await new GitHubCollector("token", request as typeof fetch).collect("OCTOCAT", "2026-W32") as any;
  expect(queries.some((query) => query.includes("created:2026-08-03..2026-08-09"))).toBe(true);
  expect(queries.some((query) => query.includes("merged:2026-08-03..2026-08-09"))).toBe(true);
  expect(result.stats.totals.openedPullRequests.value).toBe(1);
  expect(result.stats.totals.mergedPullRequests.value).toBe(1);
  expect(result.items.filter((item: any) => item.type === "pull_request")).toHaveLength(1);
});

test("statistics validation is exact, nullable when unavailable, and tied to the ISO week", () => {
  const stats = {
    period: { from: "2025-12-29", toInclusive: "2026-01-04" },
    observedAt: "2026-01-05T00:00:00.000Z",
    scopes: {
      releases: "discovered_public_contribution_repositories",
      repositories: "public_repositories_discovered_from_contributions_and_commit_search",
    },
    contributionRepositories: { status: "complete" },
    totals: {
      publicCommits: { value: 2, coverage: { status: "complete" } },
      openedPullRequests: { value: 1, coverage: { status: "complete" } },
      mergedPullRequests: { value: null, coverage: { status: "unavailable", reason: "search unavailable" } },
      releases: { value: 0, coverage: { status: "complete" } },
    },
    repositories: [{
      repo: "OctoCat/Widget", url: "https://github.com/OctoCat/Widget",
      publicCommits: { value: 2, coverage: { status: "complete" } },
      stars: { value: null, observedAt: "2026-01-05T00:00:00.000Z", coverage: { status: "unavailable", reason: "snapshot missing" } },
    }],
  };
  expect(validateActivityStatistics(stats, "2026-W01")).toBe(stats as any);
  expect(() => validateActivityStatistics({ ...stats, unexpected: true }, "2026-W01")).toThrow("unknown statistics field");
  expect(() => validateActivityStatistics(stats, "2026-W02")).toThrow("period target mismatch");
  expect(() => validateActivityStatistics({ ...stats, totals: { ...stats.totals, mergedPullRequests: { value: 0, coverage: { status: "unavailable", reason: "missing" } } } }, "2026-W01")).toThrow("invalid statistics totals.mergedPullRequests.value");
  expect(() => validateActivityStatistics({ ...stats, observedAt: "2026-02-30T00:00:00.000Z" }, "2026-W01")).toThrow("invalid statistics observedAt");
  expect(() => validateActivityStatistics({ ...stats, repositories: [{ ...stats.repositories[0], stars: { ...stats.repositories[0].stars, observedAt: "2026-04-31T00:00:00Z" } }] }, "2026-W01")).toThrow("invalid statistics repository.stars.observedAt");
  expect(() => validateActivityStatistics({ ...stats, totals: { ...stats.totals,
    publicCommits: { value: 2, coverage: { status: "truncated", observed: 1, limit: 500 } },
  } }, "2026-W01")).toThrow("invalid statistics totals.publicCommits.value");
  expect(() => validateActivityStatistics({ ...stats, totals: { ...stats.totals,
    publicCommits: { value: 1, coverage: { status: "complete" } },
  } }, "2026-W01")).toThrow("statistics repository public commits exceed total");
  expect(() => validateActivityStatistics({ ...stats, totals: { ...stats.totals,
    publicCommits: { value: 3, coverage: { status: "complete" } },
  } }, "2026-W01")).toThrow("statistics repository public commits do not match total");
  const repository = stats.repositories[0];
  const maximumRows = Array.from({ length: MAX_STATISTICS_REPOSITORIES }, (_, index) => ({
    ...repository, repo: `owner/repo-${index}`, url: `https://github.com/owner/repo-${index}`,
    publicCommits: { value: 0, coverage: { status: "complete" } },
  }));
  const zeroCommitStats = { ...stats, totals: { ...stats.totals, publicCommits: { value: 0, coverage: { status: "complete" } } } };
  expect(validateActivityStatistics({ ...zeroCommitStats, repositories: maximumRows }, "2026-W01").repositories).toHaveLength(MAX_STATISTICS_REPOSITORIES);
  expect(() => validateActivityStatistics({ ...zeroCommitStats, repositories: [...maximumRows, {
    ...repository, repo: "owner/overflow", url: "https://github.com/owner/overflow",
  }] }, "2026-W01")).toThrow("invalid statistics repositories");
});

test("release collection does not stop on old dates because old drafts can be newly published", async () => {
  const releasePages: number[] = [];
  const request = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/graphql") {
      const body = JSON.parse(String(init?.body));
      if (body.query.includes("type:DISCUSSION")) return Response.json({ data: { search: emptyDiscussionSearch() } });
      return Response.json({ data: { user: { contributionsCollection: emptyContributions({
        commitContributionsByRepository: [{ repository: { nameWithOwner: "octocat/widget", visibility: "PUBLIC", stargazerCount: 1 } }],
      }) } } });
    }
    if (url.pathname.startsWith("/search/")) return Response.json({ incomplete_results: false, total_count: 0, items: [] });
    if (url.pathname === "/repos/octocat/widget/releases") {
      const page = Number(url.searchParams.get("page"));
      releasePages.push(page);
      if (page === 1) return Response.json(Array.from({ length: 100 }, (_, id) => ({
        id: id + 1, draft: false, name: `Old ${id}`, created_at: "2020-01-01T00:00:00Z", published_at: "2020-01-02T00:00:00Z",
        html_url: `https://github.com/octocat/widget/releases/tag/old-${id}`,
      })));
      return Response.json(page === 2 ? [{
        id: 101, draft: false, name: "Former draft", created_at: "2019-01-01T00:00:00Z", published_at: "2026-08-05T00:00:00Z",
        html_url: "https://github.com/octocat/widget/releases/tag/newly-published",
      }] : []);
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const result = await new GitHubCollector("token", request as typeof fetch).collect("octocat", "2026-W32") as any;
  expect(releasePages).toEqual([1, 2]);
  expect(result.stats.totals.releases).toEqual({ value: 1, coverage: { status: "complete" } });
  expect(result.items.some((item: any) => item.id === "release:octocat/widget:101")).toBe(true);
});

test("deduplicates a release repeated across shifting pages before evidence and totals", async () => {
  const repeatedRelease = {
    id: 42, draft: false, name: "Repeated", created_at: "2026-08-04T00:00:00Z", published_at: "2026-08-05T00:00:00Z",
    html_url: "https://github.com/octocat/widget/releases/tag/repeated",
  };
  const request = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/graphql") {
      const body = JSON.parse(String(init?.body));
      if (body.query.includes("type:DISCUSSION")) return Response.json({ data: { search: emptyDiscussionSearch() } });
      return Response.json({ data: { user: { contributionsCollection: emptyContributions({
        commitContributionsByRepository: [{ repository: { nameWithOwner: "octocat/widget", visibility: "PUBLIC", stargazerCount: 1 } }],
      }) } } });
    }
    if (url.pathname.startsWith("/search/")) return Response.json({ incomplete_results: false, total_count: 0, items: [] });
    if (url.pathname === "/repos/octocat/widget/releases") {
      const page = Number(url.searchParams.get("page"));
      if (page === 1) return Response.json([
        repeatedRelease,
        ...Array.from({ length: 99 }, (_, id) => ({
          id: id + 100, draft: false, name: `Old ${id}`, created_at: "2020-01-01T00:00:00Z", published_at: "2020-01-02T00:00:00Z",
          html_url: `https://github.com/octocat/widget/releases/tag/old-${id}`,
        })),
      ]);
      if (page === 2) return Response.json([repeatedRelease]);
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const result = await new GitHubCollector("token", request as typeof fetch).collect("octocat", "2026-W32") as any;
  expect(result.stats.totals.releases).toEqual({ value: 1, coverage: { status: "complete" } });
  expect(result.items.filter((item: any) => item.id === "release:octocat/widget:42")).toHaveLength(1);
});

test("rejects malformed release pages instead of certifying an empty total", async () => {
  const valid = {
    id: 1, draft: false, published_at: "2026-08-05T00:00:00Z",
    html_url: "https://github.com/octocat/widget/releases/tag/v1",
  };
  const batches = [
    [{ ...valid, id: undefined }],
    [{ ...valid, draft: undefined }],
    [{ ...valid, published_at: "2026-02-30T00:00:00Z" }],
    [{ ...valid, html_url: undefined }],
    [{ ...valid, html_url: "https://github.com/other/widget/releases/tag/v1" }],
    Array.from({ length: 101 }, (_, index) => ({ ...valid, id: index + 1 })),
  ];
  for (const batch of batches) {
    const request = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/graphql") {
        const body = JSON.parse(String(init?.body));
        return Response.json(body.query.includes("type:DISCUSSION")
          ? { data: { search: emptyDiscussionSearch() } }
          : { data: { user: { contributionsCollection: emptyContributions({
            commitContributionsByRepository: [{ repository: { nameWithOwner: "octocat/widget", visibility: "PUBLIC", stargazerCount: 1 } }],
          }) } } });
      }
      if (url.pathname.startsWith("/search/")) return Response.json({ incomplete_results: false, total_count: 0, items: [] });
      return Response.json(batch);
    };
    await expect(new GitHubCollector("token", request as typeof fetch).collect("octocat", "2026-W32"))
      .rejects.toThrow(/GitHub releases? (page too large|item invalid)/);
  }
});

import {mergeSearchResults} from './github';
test('daily issue selection follows updated time rather than the created/merged query day',()=>{
 const result=mergeSearchResults('issues',[{id:1,updated_at:'2026-08-09T01:00:00Z'},{id:2,updated_at:'2026-08-08T01:00:00Z'},{id:1,updated_at:'2026-08-09T01:00:00Z'}]);
 expect(result.map(x=>x.id)).toEqual([1,2]);
});

test('public collection excludes private/internal repositories and draft releases even with a privileged token',async()=>{
 const releaseRepos:string[]=[];
 const request=async(input:string|URL|Request,init?:RequestInit)=>{
  const url=new URL(String(input));
  if(url.pathname==='/graphql'){
   const body=JSON.parse(String(init?.body));
   expect(body.query).toContain('visibility');
   if(body.query.includes('type:DISCUSSION')){
    expect(body.variables.q).toContain('is:public');
    return Response.json({data:{search:{discussionCount:2,pageInfo:{hasNextPage:false,endCursor:null},nodes:[
     {id:'private-discussion',title:'Private discussion',url:'https://github.com/example/private/discussions/1',repository:{nameWithOwner:'example/private',visibility:'PRIVATE'}},
     {id:'public-discussion',title:'Public discussion',url:'https://github.com/example/public/discussions/2',repository:{nameWithOwner:'example/public',visibility:'PUBLIC'}},
    ]}}});
   }
   return Response.json({data:{user:{contributionsCollection:emptyContributions({commitContributionsByRepository:[
    {repository:{nameWithOwner:'example/private',visibility:'PRIVATE'}},
    {repository:{nameWithOwner:'example/internal',visibility:'INTERNAL'}},
    {repository:{nameWithOwner:'example/public',visibility:'PUBLIC'}},
   ]})}}});
  }
  if(url.pathname.startsWith('/search/')){
   expect(url.searchParams.get('q')).toContain('is:public');
   return Response.json({items:[],incomplete_results:false,total_count:0});
  }
  releaseRepos.push(url.pathname);
  return Response.json([
   {id:1,name:'Draft',html_url:'https://github.com/example/public/releases/tag/draft',created_at:'2026-08-04T00:00:00Z',draft:true},
   {id:2,name:'Published',html_url:'https://github.com/example/public/releases/tag/v1',published_at:'2026-08-04T00:00:00Z',draft:false},
  ]);
 };
 const result=await new GitHubCollector('test-privileged-token',request as typeof fetch).collect('octocat','2026-W32');
 expect(releaseRepos).toEqual(['/repos/example/public/releases']);
 expect(result.items.map(x=>x.id)).toEqual(['discussion:public-discussion','release:example/public:2','repository:example/public']);
});

test('unknown repository visibility fails instead of declaring a quiet public week',async()=>{
 const request=async(_input:string|URL|Request)=>Response.json({data:{user:{contributionsCollection:emptyContributions({commitContributionsByRepository:[{repository:{nameWithOwner:'example/repo'}}]})}}});
 await expect(new GitHubCollector('test-token',request as typeof fetch).collect('octocat','2026-W32')).rejects.toThrow('visibility missing');
});
