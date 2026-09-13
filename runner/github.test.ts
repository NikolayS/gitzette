import { describe, expect, test } from "bun:test";
import { GitHubCollector, isoWeek } from "./github";
import { MAX_STATISTICS_REPOSITORIES, validateActivityStatistics } from "../src/statistics";

describe("canonical GitHub collector", () => {
  test("computes exact ISO-week boundaries", () => {
    expect(isoWeek("2026-W01")).toEqual({ from: "2025-12-29", toExclusive: "2026-01-05", toInclusive: "2026-01-04" });
    expect(isoWeek("2026-W32")).toEqual({ from: "2026-08-03", toExclusive: "2026-08-10", toInclusive: "2026-08-09" });
    expect(() => isoWeek("2027-W53")).toThrow("does not exist");
  });

  test("uses only api.github.com and freezes returned evidence", async () => {
    const urls: string[] = [];
    const request = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      if (url === "https://api.github.com/graphql") {
        const requestBody = JSON.parse(String(init?.body ?? "{}"));
        if (requestBody.query?.includes("type:DISCUSSION")) return Response.json({ data: { search: { discussionCount: 0, nodes: [] } } });
        return Response.json({ data: { user: { contributionsCollection: {
          commitContributionsByRepository: [
            { repository: { visibility: "PUBLIC", nameWithOwner: "octocat/widget", stargazerCount: 17 } },
            { repository: { visibility: "PUBLIC", nameWithOwner: "../evil" } },
          ],
          issueContributions: { nodes: [] }, pullRequestContributions: { nodes: [] }, repositoryContributions: { nodes: [] },
        } } } });
      }
      if (url.includes("/releases?")) return Response.json([]);
      if (url.includes("/search/commits")) return Response.json({ incomplete_results: false, items: [{ sha: "abc", html_url: "https://github.com/octocat/widget/commit/abc", commit: { message: "Fix parser\nbody" }, repository: { full_name: "octocat/widget" } }] });
      return Response.json({ incomplete_results: false, items: [] });
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
        return Response.json({ data: { user: { contributionsCollection: {
          commitContributionsByRepository: [], issueContributions: { nodes: [] },
          pullRequestContributions: { nodes: [] }, repositoryContributions: { nodes: [] },
        } } } });
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

  test("deduplicates shifting commit search pages without changing the exact aggregate", async () => {
    const request = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/graphql") {
        const body = JSON.parse(String(init?.body));
        return Response.json(body.query.includes("type:DISCUSSION")
          ? { data: { search: { discussionCount: 0, nodes: [] } } }
          : { data: { user: { contributionsCollection: {} } } });
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
        return Response.json({ data: { user: { contributionsCollection: {
          commitContributionsByRepository: [], issueContributions: { nodes: [] },
          pullRequestContributions: { nodes: [] }, repositoryContributions: { nodes: [] },
        } } } });
      }
      return Response.json({ incomplete_results: false, total_count: 0, items: [] });
    };
    const evidence = await new GitHubCollector("token", request as typeof fetch).collect("octocat", "2026-W32");
    expect(cursors).toEqual([null, "page-2"]);
    expect(evidence.items).toHaveLength(101);
  });
});


test("incomplete weekly searches use bounded daily windows and still fail closed", async () => {
  for (const failDaily of [false, true]) {
    const commitQueries: string[] = [];
    const request = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/graphql") {
        const body = JSON.parse(String(init?.body));
        if (body.query.includes("type:DISCUSSION")) return Response.json({ data: { search: { discussionCount: 0, nodes: [] } } });
        return Response.json({ data: { user: { contributionsCollection: {} } } });
      }
      if (url.pathname !== "/search/commits") return Response.json({ items: [], incomplete_results: false });
      const q = url.searchParams.get("q")!;
      commitQueries.push(q);
      const weekly = q.includes("2026-08-03..2026-08-09");
      return Response.json({ incomplete_results: weekly || failDaily, items: weekly ? [] : [{
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
   return Response.json(body.query.includes('type:DISCUSSION')?{data:{search:{discussionCount:0,nodes:[]}}}:{data:{user:{contributionsCollection:{}}}});
  }
  if(url.pathname!=='/search/commits')return Response.json({items:[],incomplete_results:false});
  const q=url.searchParams.get('q')!;
  if(q.includes('2026-08-03..2026-08-09'))return Response.json({items:[],incomplete_results:true});
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
        ? { data: { search: { discussionCount: 0, nodes: [] } } }
        : { data: { user: { contributionsCollection: {} } } });
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
  const repository = stats.repositories[0];
  const maximumRows = Array.from({ length: MAX_STATISTICS_REPOSITORIES }, (_, index) => ({
    ...repository, repo: `owner/repo-${index}`, url: `https://github.com/owner/repo-${index}`,
  }));
  expect(validateActivityStatistics({ ...stats, repositories: maximumRows }, "2026-W01").repositories).toHaveLength(MAX_STATISTICS_REPOSITORIES);
  expect(() => validateActivityStatistics({ ...stats, repositories: [...maximumRows, {
    ...repository, repo: "owner/overflow", url: "https://github.com/owner/overflow",
  }] }, "2026-W01")).toThrow("invalid statistics repositories");
});

test("release collection does not stop on old dates because old drafts can be newly published", async () => {
  const releasePages: number[] = [];
  const request = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/graphql") {
      const body = JSON.parse(String(init?.body));
      if (body.query.includes("type:DISCUSSION")) return Response.json({ data: { search: { discussionCount: 0, nodes: [] } } });
      return Response.json({ data: { user: { contributionsCollection: {
        commitContributionsByRepository: [{ repository: { nameWithOwner: "octocat/widget", visibility: "PUBLIC", stargazerCount: 1 } }],
      } } } });
    }
    if (url.pathname.startsWith("/search/")) return Response.json({ incomplete_results: false, total_count: 0, items: [] });
    if (url.pathname === "/repos/octocat/widget/releases") {
      const page = Number(url.searchParams.get("page"));
      releasePages.push(page);
      if (page === 1) return Response.json(Array.from({ length: 100 }, (_, id) => ({
        id, draft: false, name: `Old ${id}`, created_at: "2020-01-01T00:00:00Z", published_at: "2020-01-02T00:00:00Z",
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
      if (body.query.includes("type:DISCUSSION")) return Response.json({ data: { search: { discussionCount: 0, nodes: [] } } });
      return Response.json({ data: { user: { contributionsCollection: {
        commitContributionsByRepository: [{ repository: { nameWithOwner: "octocat/widget", visibility: "PUBLIC", stargazerCount: 1 } }],
      } } } });
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
    return Response.json({data:{search:{discussionCount:2,nodes:[
     {id:'private-discussion',title:'Private discussion',url:'https://github.com/example/private/discussions/1',repository:{nameWithOwner:'example/private',visibility:'PRIVATE'}},
     {id:'public-discussion',title:'Public discussion',url:'https://github.com/example/public/discussions/2',repository:{nameWithOwner:'example/public',visibility:'PUBLIC'}},
    ]}}});
   }
   return Response.json({data:{user:{contributionsCollection:{commitContributionsByRepository:[
    {repository:{nameWithOwner:'example/private',visibility:'PRIVATE'}},
    {repository:{nameWithOwner:'example/internal',visibility:'INTERNAL'}},
    {repository:{nameWithOwner:'example/public',visibility:'PUBLIC'}},
   ]}}}});
  }
  if(url.pathname.startsWith('/search/')){
   expect(url.searchParams.get('q')).toContain('is:public');
   return Response.json({items:[]});
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
 const request=async(_input:string|URL|Request)=>Response.json({data:{user:{contributionsCollection:{commitContributionsByRepository:[{repository:{nameWithOwner:'example/repo'}}]}}}});
 await expect(new GitHubCollector('test-token',request as typeof fetch).collect('octocat','2026-W32')).rejects.toThrow('visibility missing');
});
