import { describe, expect, test } from "bun:test";
import { addArticleMarkers, isLegacyEmptyDispatch, slowNewsCopy, slowNewsFragment } from "./dispatch-health";

describe("empty dispatch recovery", () => {
  test("recognizes both legacy empty payloads", () => {
    expect(isLegacyEmptyDispatch("<p>No activity this week.</p>")).toBe(true);
    expect(isLegacyEmptyDispatch("  <p>No public repos found.</p>\n")).toBe(true);
    expect(isLegacyEmptyDispatch("<p>A real article.</p>")).toBe(false);
  });

  test("recognizes full documents with a masthead but no articles", () => {
    expect(isLegacyEmptyDispatch(`<!DOCTYPE html><html><head><style>.article { color: black; }</style></head><body><div class="masthead">the dispatch</div></body></html>`)).toBe(true);
    expect(isLegacyEmptyDispatch(`<!DOCTYPE html><html><body><h2>Real headline</h2><p>Real body</p></body></html>`)).toBe(false);
    expect(isLegacyEmptyDispatch(`<!DOCTYPE html><html><body><section class="article">News</section></body></html>`)).toBe(false);
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
