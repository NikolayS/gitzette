import { describe, expect, test } from "bun:test";
import { renderStatisticsSidebar, renderStatisticsSummaryStrip } from "./statistics-view";
import type { ActivityStatistics } from "./statistics";

function statistics(): ActivityStatistics {
  return {
    period: { from: "2026-04-06", toInclusive: "2026-04-12" },
    observedAt: "2026-09-13T14:05:00.000Z",
    scopes: {
      releases: "discovered_public_contribution_repositories",
      repositories: "public_repositories_discovered_from_contributions_and_commit_search",
    },
    totals: {
      publicCommits: { value: 42, coverage: { status: "complete" } },
      openedPullRequests: { value: 7, coverage: { status: "complete" } },
      mergedPullRequests: { value: 5, coverage: { status: "complete" } },
      releases: { value: 2, coverage: { status: "complete" } },
    },
    repositories: [{
      repo: "octocat/widget", url: "https://github.com/octocat/widget", publicCommits: { value: 32, coverage: { status: "complete" } },
      stars: { value: 1234, coverage: { status: "complete" }, observedAt: "2026-09-13T14:05:00.000Z" },
    }],
    contributionRepositories: { status: "complete" },
  };
}

describe("statistics view", () => {
  test("renders actual activity categories and labels stars as a current snapshot", () => {
    const html = renderStatisticsSidebar(statistics());
    expect(html).toContain("public commits");
    expect(html).toContain("PRs opened");
    expect(html).toContain("PRs merged");
    expect(html).toContain("1,234");
    expect(html).toContain("current snapshot");
    expect(html).toContain("Release counts cover discovered public contribution repositories");
    expect(html).toContain('datetime="2026-09-13T14:05:00.000Z"');
    expect(html).toContain('Observed <time datetime="2026-09-13T14:05:00.000Z">Sep 13, 2026, 2:05 PM UTC</time>');
    expect(html).not.toContain("★");
  });

  test("escapes labels, notes, timestamps and rejects unsafe repository links", () => {
    const input = statistics();
    input.observedAt = '<img src=x onerror="alert(1)">';
    input.repositories[0].repo = 'octocat/<script>alert("repo")</script>';
    input.repositories[0].url = 'javascript:alert("link")';
    input.contributionRepositories = { status: "unavailable", reason: "<b>API outage</b>" };
    const html = renderStatisticsSidebar(input);
    expect(html).toContain("octocat/&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;API outage&lt;/b&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("javascript:");
  });

  test("shows lower bounds, partial coverage and unavailable values without inventing zeroes", () => {
    const input = statistics();
    input.totals.publicCommits = { value: 100, coverage: { status: "truncated", observed: 100, limit: 100 } };
    input.totals.releases = { value: null, coverage: { status: "unavailable", reason: "endpoint unavailable" } };
    input.repositories = [];
    input.contributionRepositories = { status: "truncated", observed: 100, limit: 100 };
    const sidebar = renderStatisticsSidebar(input);
    const strip = renderStatisticsSummaryStrip(input);
    for (const html of [sidebar, strip]) {
      expect(html).toContain("≥100");
      expect(html).toContain("not available");
    }
    expect(sidebar).toContain("Partial repository coverage");
    expect(sidebar).toContain("No repository-level commit counts are available");
    expect(sidebar).not.toContain(">0<");
  });

  test("ranks commit and star rows independently, preserves zero and labels differing star observations", () => {
    const input = statistics();
    input.repositories = [
      ...input.repositories,
      {
        repo: "octocat/other",
        url: "https://github.com/octocat/other",
        publicCommits: { value: 0, coverage: { status: "complete" } },
        stars: { value: 2000, coverage: { status: "complete" }, observedAt: "2026-09-12T12:00:00.000Z" },
      },
    ];
    const html = renderStatisticsSidebar(input);
    const commits = html.slice(html.indexOf("Public commits by repository"), html.indexOf("Repository stars"));
    const stars = html.slice(html.indexOf("Repository stars"));
    expect(commits.indexOf("octocat/widget")).toBeLessThan(commits.indexOf("octocat/other"));
    expect(stars.indexOf("octocat/other")).toBeLessThan(stars.indexOf("octocat/widget"));
    expect(commits).toContain('style="width:0%"');
    expect(stars).toContain('Observed <time datetime="2026-09-12T12:00:00.000Z">Sep 12, 2026, 12:00 PM UTC</time>');
    expect(stars.match(/>Observed <time/g)).toHaveLength(1);
  });

  test("preserves mixed unavailable repository rows with reasons and no fabricated bars", () => {
    const input = statistics();
    input.repositories.push({
      repo: "octocat/missing",
      url: "https://github.com/octocat/missing",
      publicCommits: { value: null, coverage: { status: "unavailable", reason: "commit <cap> reached" } },
      stars: { value: null, coverage: { status: "unavailable", reason: "stars & private" }, observedAt: input.observedAt },
    });
    const html = renderStatisticsSidebar(input);
    const missingCommitStart = html.indexOf("octocat/missing", html.indexOf("Public commits by repository"));
    const commitRow = html.slice(missingCommitStart, html.indexOf("Repository stars", missingCommitStart));
    const starRow = html.match(/<tr><th scope="row"><a[^>]*>octocat\/missing<\/a>[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(commitRow).toContain("—");
    expect(commitRow).toContain("not available: commit &lt;cap&gt; reached");
    expect(commitRow).not.toContain("dispatch-repo-track");
    expect(starRow).toContain("—");
    expect(starRow).toContain("not available: stars &amp; private");
    expect(starRow).not.toContain("dispatch-star-bar");
    expect(html).toContain("measurements are incomplete for 1 commit row and 1 star row");
  });
});
