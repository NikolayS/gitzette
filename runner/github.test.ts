import { describe, expect, test } from "bun:test";
import { GitHubCollector, isoWeek } from "./github";

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
            { repository: { nameWithOwner: "octocat/widget" } },
            { repository: { nameWithOwner: "../evil" } },
          ],
          issueContributions: { nodes: [] }, pullRequestContributions: { nodes: [] }, repositoryContributions: { nodes: [] },
        } } } });
      }
      if (url.includes("/releases?")) return Response.json([]);
      if (url.includes("/search/commits")) return Response.json({ incomplete_results: false, items: [{ sha: "abc", html_url: "https://github.com/octocat/widget/commit/abc", commit: { message: "Fix parser\nbody" }, repository: { full_name: "octocat/widget" } }] });
      return Response.json({ incomplete_results: false, items: [] });
    };
    const evidence = await new GitHubCollector("token", request as typeof fetch).collect("octocat", "2026-W32");
    expect(urls.every((url) => new URL(url).hostname === "api.github.com")).toBe(true);
    expect(evidence.state).toBe("active");
    expect(evidence.items.map((item) => item.id)).toEqual(["commit:abc", "repository:octocat/widget"]);
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
              repository: { nameWithOwner: "octocat/widget" },
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
