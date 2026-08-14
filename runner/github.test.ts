import { describe, expect, test } from "bun:test";
import { GitHubCollector, isoWeek } from "./github";

describe("canonical GitHub collector", () => {
  test("computes exact ISO-week boundaries", () => {
    expect(isoWeek("2026-W01")).toEqual({ from: "2025-12-29", toExclusive: "2026-01-05", toInclusive: "2026-01-04" });
    expect(isoWeek("2026-W32")).toEqual({ from: "2026-08-03", toExclusive: "2026-08-10", toInclusive: "2026-08-09" });
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
          commitContributionsByRepository: [{ repository: { nameWithOwner: "octocat/widget" } }],
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
});
