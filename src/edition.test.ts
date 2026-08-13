import { describe, expect, test } from "bun:test";
import { escapeHtml, renderEdition, validateManifest, type PublicationManifest } from "./edition";

function activeManifest(): PublicationManifest {
  return {
    generatorVersion: "test-1",
    model: "openai/gpt-5.6-sol",
    promptVersion: "editor-1",
    evidence: {
      state: "active",
      username: "octocat",
      weekKey: "2026-W32",
      items: [
        { id: "pr:1", type: "pull_request", title: "Fix parser", url: "https://github.com/octocat/widget/pull/1", repo: "octocat/widget" },
      ],
    },
    edition: {
      headline: "The parser reaches the end",
      tagline: "One boundary condition, finally bounded.",
      closingNote: "The cursor now stops where the input does.",
      stories: [{
        headline: "The final byte gets read",
        deck: "A parser boundary stopped being aspirational.",
        paragraphs: ["The parser now checks the final byte before returning."],
        evidenceIds: ["pr:1"],
        tag: "FEATURE",
        illustrationKey: "image-1.webp",
      }, {
        headline: "The second angle",
        deck: "The same evidence can support another factual angle.",
        paragraphs: ["The change is small and its consequence is concrete."],
        evidenceIds: ["pr:1"],
        tag: "COMMUNITY",
        illustrationKey: "image-2.webp",
      }],
    },
    images: [
      { key: "image-1.webp", contentType: "image/webp", sha256: "a".repeat(64) },
      { key: "image-2.webp", contentType: "image/webp", sha256: "b".repeat(64) },
    ],
  };
}

describe("typed publication manifest", () => {
  test("accepts an evidence-backed active edition with two images", () => {
    expect(validateManifest(activeManifest(), "octocat", "2026-W32").edition.stories).toHaveLength(2);
  });

  test("rejects unsupported claims and non-GitHub evidence links", () => {
    const unsupported = activeManifest();
    unsupported.edition.stories[0].evidenceIds = ["pr:404"];
    expect(() => validateManifest(unsupported, "octocat", "2026-W32")).toThrow("unknown evidence id");

    const hostile = activeManifest();
    hostile.evidence.items[0].url = "javascript:alert(1)";
    expect(() => validateManifest(hostile, "octocat", "2026-W32")).toThrow("non-GitHub evidence URL");
  });

  test("rejects active editions with fewer than two unique illustrations", () => {
    const manifest = activeManifest();
    manifest.images.pop();
    manifest.edition.stories.pop();
    expect(() => validateManifest(manifest, "octocat", "2026-W32")).toThrow("requires at least 2 illustrations");
  });

  test("rejects duplicate image bytes and invalid runtime enum values", () => {
    const duplicate = activeManifest();
    duplicate.images[1].sha256 = duplicate.images[0].sha256;
    expect(() => validateManifest(duplicate, "octocat", "2026-W32")).toThrow("duplicate image content");

    const invalidType = activeManifest();
    (invalidType.evidence.items[0] as any).type = "web_search";
    expect(() => validateManifest(invalidType, "octocat", "2026-W32")).toThrow("invalid evidence type");

    const invalidTag = activeManifest();
    (invalidTag.edition.stories[0] as any).tag = "INSTRUCTION";
    expect(() => validateManifest(invalidTag, "octocat", "2026-W32")).toThrow("invalid story tag");
  });

  test("distinguishes quiet weeks from collection failures", () => {
    const quiet = activeManifest();
    quiet.evidence.state = "quiet";
    quiet.evidence.items = [];
    quiet.edition.stories = [];
    quiet.images = [];
    quiet.edition.headline = "Model-authored fiction";
    const validated = validateManifest(quiet, "octocat", "2026-W32");
    expect(validated.edition.headline).toBe("A Quiet Week for @octocat");

    quiet.evidence.state = "collection_failed";
    expect(() => validateManifest(quiet, "octocat", "2026-W32")).toThrow("collection failed");
  });

  test("escapes hostile model text and creates links only from evidence", () => {
    const manifest = activeManifest();
    manifest.edition.stories[0].paragraphs = ["<script>alert('owned')</script>"];
    const html = renderEdition(validateManifest(manifest, "octocat", "2026-W32"), (key) => `/img/${key}`);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("https://github.com/octocat/widget/pull/1");
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});
