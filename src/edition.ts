import { TEXT_MODEL } from "./models";
export const ACTIVE_MIN_IMAGES = 2;
export const ACTIVE_MAX_IMAGES = 3;

export type EvidenceItem = {
  id: string;
  type: "commit" | "pull_request" | "issue" | "release" | "discussion" | "repository";
  title: string;
  url: string;
  repo: string;
};

export type EvidenceBundle = {
  state: "active" | "quiet" | "collection_failed";
  username: string;
  weekKey: string;
  items: EvidenceItem[];
};

export type EditionStory = {
  headline: string;
  deck: string;
  paragraphs: string[];
  evidenceIds: string[];
  tag: "RELEASE" | "FEATURE" | "SECURITY" | "PENDING" | "COMMUNITY";
  illustrationKey?: string;
};

export type Edition = {
  headline: string;
  tagline: string;
  closingNote: string;
  stories: EditionStory[];
};

export type PublicationManifest = {
  generatorVersion: string;
  model: typeof TEXT_MODEL | "deterministic";
  promptVersion: string;
  evidence: EvidenceBundle;
  edition: Edition;
  images: { key: string; contentType: "image/webp"; sha256: string }[];
};

const EVIDENCE_TYPES = new Set(["commit", "pull_request", "issue", "release", "discussion", "repository"]);
const STORY_TAGS = new Set(["RELEASE", "FEATURE", "SECURITY", "PENDING", "COMMUNITY"]);

function assertExactKeys(value: unknown, field: string, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid ${field}`);
  const allow = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allow.has(key));
  if (unknown.length > 0) throw new Error(`unknown ${field} field: ${unknown[0]}`);
}

export function quietEdition(username: string, weekKey: string): Edition {
  return {
    headline: `A Quiet Week for @${username}`,
    tagline: `${weekKey} passed without public GitHub activity.`,
    closingNote: "The presses remain ready.",
    stories: [],
  };
}

function assertString(value: unknown, field: string, max: number): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw new Error(`invalid ${field}`);
  }
}

function isGitHubUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && (url.hostname === "github.com" || url.hostname === "api.github.com");
  } catch {
    return false;
  }
}

export function validateManifest(input: unknown, username: string, weekKey: string): PublicationManifest {
  assertExactKeys(input, "manifest", ["generatorVersion", "model", "promptVersion", "evidence", "edition", "images"]);
  const manifest = input as PublicationManifest;
  assertString(manifest.generatorVersion, "generatorVersion", 100);
  if (manifest.model !== TEXT_MODEL && manifest.model !== "deterministic") throw new Error("forbidden model");
  assertString(manifest.promptVersion, "promptVersion", 100);

  const evidence = manifest.evidence;
  assertExactKeys(evidence, "evidence", ["state", "username", "weekKey", "items"]);
  if (!evidence || evidence.username !== username || evidence.weekKey !== weekKey) {
    throw new Error("evidence target mismatch");
  }
  if (!(["active", "quiet", "collection_failed"] as const).includes(evidence.state)) {
    throw new Error("invalid evidence state");
  }
  if (!Array.isArray(evidence.items) || evidence.items.length > 500) throw new Error("invalid evidence items");
  const evidenceIds = new Set<string>();
  for (const item of evidence.items) {
    assertExactKeys(item, "evidence item", ["id", "type", "title", "url", "repo"]);
    if (!EVIDENCE_TYPES.has(item.type)) throw new Error("invalid evidence type");
    assertString(item.id, "evidence id", 120);
    assertString(item.title, "evidence title", 500);
    assertString(item.repo, "evidence repo", 200);
    if (!isGitHubUrl(item.url)) throw new Error("non-GitHub evidence URL");
    if (evidenceIds.has(item.id)) throw new Error("duplicate evidence id");
    evidenceIds.add(item.id);
  }
  if (evidence.state === "collection_failed") throw new Error("collection failed");
  if (evidence.state === "active" && evidence.items.length === 0) throw new Error("active edition has no evidence");
  if (evidence.state === "quiet" && evidence.items.length !== 0) throw new Error("quiet edition contains evidence");

  const edition = manifest.edition;
  assertExactKeys(edition, "edition", ["headline", "tagline", "closingNote", "stories"]);
  if (!edition || !Array.isArray(edition.stories) || edition.stories.length > 8) throw new Error("invalid edition stories");
  assertString(edition.headline, "edition headline", 160);
  assertString(edition.tagline, "edition tagline", 300);
  assertString(edition.closingNote, "closingNote", 300);

  const usedIllustrations = new Set<string>();
  for (const story of edition.stories) {
    assertExactKeys(story, "story", ["headline", "deck", "paragraphs", "evidenceIds", "tag", "illustrationKey"]);
    if (!STORY_TAGS.has(story.tag)) throw new Error("invalid story tag");
    assertString(story.headline, "story headline", 240);
    assertString(story.deck, "story deck", 500);
    if (!Array.isArray(story.paragraphs) || story.paragraphs.length < 1 || story.paragraphs.length > 4) {
      throw new Error("invalid story paragraphs");
    }
    story.paragraphs.forEach((paragraph) => assertString(paragraph, "story paragraph", 2000));
    if (!Array.isArray(story.evidenceIds) || story.evidenceIds.length < 1 || story.evidenceIds.length > 12) {
      throw new Error("invalid story evidenceIds");
    }
    for (const id of story.evidenceIds) {
      if (!evidenceIds.has(id)) throw new Error(`unknown evidence id: ${id}`);
    }
    if (story.illustrationKey) {
      if (!/^image-[1-3]\.webp$/.test(story.illustrationKey)) throw new Error("invalid illustration key");
      if (usedIllustrations.has(story.illustrationKey)) throw new Error("duplicate illustration use");
      usedIllustrations.add(story.illustrationKey);
    }
  }

  if (!Array.isArray(manifest.images) || manifest.images.length > ACTIVE_MAX_IMAGES) throw new Error("invalid images");
  const imageKeys = new Set<string>();
  const imageHashes = new Set<string>();
  for (const image of manifest.images) {
    assertExactKeys(image, "image", ["key", "contentType", "sha256"]);
    if (!/^image-[1-3]\.webp$/.test(image.key) || image.contentType !== "image/webp" || !/^[a-f0-9]{64}$/.test(image.sha256)) {
      throw new Error("invalid image metadata");
    }
    if (imageKeys.has(image.key)) throw new Error("duplicate image key");
    if (imageHashes.has(image.sha256)) throw new Error("duplicate image content");
    imageKeys.add(image.key);
    imageHashes.add(image.sha256);
  }
  for (const key of usedIllustrations) if (!imageKeys.has(key)) throw new Error("missing illustration artifact");

  if (evidence.state === "active") {
    if (manifest.model !== TEXT_MODEL) throw new Error("active edition requires gpt-6-astra");
    if (edition.stories.length === 0) throw new Error("active edition has no stories");
    if (manifest.images.length < ACTIVE_MIN_IMAGES || usedIllustrations.size < ACTIVE_MIN_IMAGES) {
      throw new Error(`active edition requires at least ${ACTIVE_MIN_IMAGES} illustrations`);
    }
  } else if (edition.stories.length !== 0 || manifest.images.length !== 0) {
    throw new Error("quiet edition must be deterministic and image-free");
  } else {
    if (manifest.model !== "deterministic") throw new Error("quiet edition must declare deterministic model");
    // Quiet-week prose is server-owned, so a model cannot turn an empty
    // evidence bundle into unsupported editorial copy.
    manifest.edition = quietEdition(username, weekKey);
  }
  return manifest;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

export const AI_ACTIVITY_NOTICE = "AI-generated from public GitHub activity.";

export function renderEdition(manifest: PublicationManifest, imageUrl: (key: string) => string): string {
  const { evidence, edition } = manifest;
  if (evidence.state === "quiet") {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>@${escapeHtml(evidence.username)} — ${escapeHtml(evidence.weekKey)}</title></head><body><main><article class="article"><h1>${escapeHtml(edition.headline)}</h1><p class="deck">${escapeHtml(edition.tagline)}</p><p class="notice">${AI_ACTIVITY_NOTICE}</p><p>The public record shows no activity for this completed week. The presses remain ready.</p></article><footer>${escapeHtml(edition.closingNote)}</footer></main></body></html>`;
  }
  const byId = new Map(evidence.items.map((item) => [item.id, item]));
  const stories = edition.stories.map((story) => {
    const citations = story.evidenceIds.map((id) => byId.get(id)!).map((item) =>
      `<a rel="noopener noreferrer" href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a>`
    ).join(" · ");
    const image = story.illustrationKey
      ? `<img src="${escapeHtml(imageUrl(story.illustrationKey))}" alt="" width="512" height="512">`
      : "";
    return `<article>${image}<div class="tag">${escapeHtml(story.tag)}</div><h2>${escapeHtml(story.headline)}</h2><p><em>${escapeHtml(story.deck)}</em></p>${story.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}<p class="sources">Sources: ${citations}</p></article>`;
  }).join("");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(edition.headline)}</title><style>body{margin:0;background:#e8e4dc;color:#111;font:16px/1.6 Georgia,serif}main{max-width:960px;margin:24px auto;padding:32px;background:#f7f4ee;border:1px solid #c8c2b4}header{border-bottom:3px solid #111}article{display:flow-root;padding:28px 0;border-bottom:1px solid #c8c2b4}article img{float:left;width:180px;height:180px;object-fit:contain;margin:0 20px 12px 0}.tag,.sources,.notice,footer{font:12px/1.4 monospace}.sources,.notice{color:#555}@media(max-width:600px){main{margin:0;padding:20px}article img{width:130px;height:130px}}</style></head><body><main><header><h1>${escapeHtml(edition.headline)}</h1><p class="deck"><em>${escapeHtml(edition.tagline)}</em></p><p>@${escapeHtml(evidence.username)} · ${escapeHtml(evidence.weekKey)}</p><p class="notice">${AI_ACTIVITY_NOTICE}</p></header>${stories}<footer>${escapeHtml(edition.closingNote)}</footer></main></body></html>`;
}
