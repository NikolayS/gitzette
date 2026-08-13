import { describe, expect, test } from "bun:test";
import { addArticleMarkers, isLegacyEmptyDispatch, slowNewsCopy, slowNewsFragment } from "./dispatch-health";
import { assertPublishableDispatch, validateGeneratedCopy } from "./generate";

describe("empty dispatch recovery", () => {
  test("recognizes both legacy empty payloads", () => {
    expect(isLegacyEmptyDispatch("<p>No activity this week.</p>")).toBe(true);
    expect(isLegacyEmptyDispatch("  <p>No public repos found.</p>\n")).toBe(true);
    expect(isLegacyEmptyDispatch("<p>A real article.</p>")).toBe(false);
  });

  test("builds a useful slow-news edition", () => {
    const copy = slowNewsCopy("octocat");
    expect(copy.articles).toHaveLength(1);
    expect(copy.articles[0].headline).toContain("Moment of Silence");
    expect(copy.articles[0].deck).toContain("@octocat");
    expect(slowNewsFragment("octocat")).toContain("The presses remain ready");
    expect(slowNewsFragment("octocat")).toContain(`class="article"`);
  });

  test("adds semantic markers to generated article blocks", () => {
    const html = `<div style="margin-bottom:32px;padding-bottom:32px;border-bottom:1px solid var(--rule);"><h2>News</h2></div>`;
    expect(addArticleMarkers(html)).toContain(`<div class="article"`);
  });
});

describe("publication guard", () => {
  const repo = {
    name: "widget",
    description: null,
    url: "https://github.com/octocat/widget",
    stars: 0,
    releases: [],
    mergedPRs: [],
    openPRs: [],
    commitCount: 1,
    demoImages: [],
  };

  test("rejects empty or unknown LLM articles", () => {
    expect(() => validateGeneratedCopy({ articles: [] }, [repo])).toThrow("no publishable articles");
    expect(() => validateGeneratedCopy({ articles: [{ repo: "invented", headline: "x", body: "y" }] }, [repo]))
      .toThrow("no publishable articles");
  });

  test("keeps valid articles and drops hallucinated repos", () => {
    const result = validateGeneratedCopy({ articles: [
      { repo: "invented", headline: "x", body: "y" },
      { repo: "widget", headline: "Widget ships", body: "One commit landed." },
    ] }, [repo]);
    expect(result.articles).toHaveLength(1);
    expect(result.articles[0].repo).toBe("widget");
  });

  test("refuses article-free HTML", () => {
    expect(() => assertPublishableDispatch("<p>No activity this week.</p>"))
      .toThrow("without an article");
    expect(() => assertPublishableDispatch("<h2>Headline</h2><p>Body</p>"))
      .not.toThrow();
  });
});
