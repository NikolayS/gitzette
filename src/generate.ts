import { Hono } from "hono";
import { getUser } from "./auth";
import { checkUserQuota, checkGlobalBudget, recordSpend, recordGeneration } from "./quota";
import type { Env } from "./index";

export const generateRoutes = new Hono<{ Bindings: Env }>();

// ── route handlers ────────────────────────────────────────────────────────────

generateRoutes.post("/", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "not authenticated" }, 401);

  const weeklyLimit = parseInt(c.env.WEEKLY_REGEN_LIMIT ?? "3");
  const monthlyBudget = parseFloat(c.env.MONTHLY_LLM_BUDGET_USD ?? "50");

  const quota = await checkUserQuota(c.env.DB, user.id, weeklyLimit);
  if (!quota.allowed) {
    return c.json({
      error: "weekly_limit_reached",
      message: `You've used all ${quota.limit} generations this week. Resets Monday. Community-supported — sponsor the project at https://github.com/sponsors/NikolayS to get more generations per week.`,
      used: quota.used, limit: quota.limit,
      sponsor_url: "https://github.com/sponsors/NikolayS",
    }, 429);
  }

  const budget = await checkGlobalBudget(c.env.DB, monthlyBudget);
  if (!budget.allowed) {
    return c.json({
      error: "global_budget_reached",
      message: "Monthly generation capacity is full. Try again next month. Community-supported — sponsor the project at https://github.com/sponsors/NikolayS to help expand capacity.",
      sponsor_url: "https://github.com/sponsors/NikolayS",
    }, 503);
  }

  // mark as generating (sentinel row — deleted on completion)
  await c.env.DB.prepare(
    `INSERT INTO dispatches (user_id, week_key, r2_key, generated_at) VALUES (?, 'generating', NULL, unixepoch())
     ON CONFLICT(user_id, week_key) DO UPDATE SET r2_key=NULL, generated_at=unixepoch()`
  ).bind(user.id).run();

  // run generation in the background (waitUntil keeps the Worker alive after response)
  c.executionCtx.waitUntil(
    runGeneration(c.env, user).catch(err => console.error("generation failed:", err))
  );

  // record quota immediately
  await recordGeneration(c.env.DB, user.id);
  await recordSpend(c.env.DB, 0.10); // estimated

  return c.json({ status: "queued", message: "Generating your dispatch... reload in 60 seconds." });
});

generateRoutes.get("/status", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "not authenticated" }, 401);

  // Check for generating sentinel first
  const sentinel = await c.env.DB.prepare(
    `SELECT generated_at FROM dispatches WHERE user_id = ? AND week_key = 'generating'`
  ).bind(user.id).first<{ generated_at: number }>();

  if (sentinel) {
    const ageSeconds = Math.floor(Date.now() / 1000) - sentinel.generated_at;
    const TTL = 5 * 60; // 5 minutes
    if (ageSeconds > TTL) {
      // Generation timed out — clean up sentinel, return failed status
      await c.env.DB.prepare(
        `DELETE FROM dispatches WHERE user_id = ? AND week_key = 'generating'`
      ).bind(user.id).run();
      return c.json({ status: "failed", message: "Generation timed out. Please try again." });
    }
    return c.json({ status: "generating", age: ageSeconds });
  }

  // Look for a real completed dispatch
  const row = await c.env.DB.prepare(
    `SELECT week_key, generated_at FROM dispatches WHERE user_id = ? AND week_key != 'generating' AND r2_key IS NOT NULL ORDER BY generated_at DESC LIMIT 1`
  ).bind(user.id).first<{ week_key: string; generated_at: number }>();
  if (!row) return c.json({ status: "none" });
  return c.json({ status: "ready", week_key: row.week_key, generated_at: row.generated_at });
});

// ── types ─────────────────────────────────────────────────────────────────────

interface Release { tag: string; name: string; date: string; body: string; url: string; }
interface PR { number: number; title: string; state: "open" | "merged"; date: string; url: string; author: string; }
interface RepoData {
  name: string; description: string | null; url: string; stars: number;
  releases: Release[]; mergedPRs: PR[]; openPRs: PR[];
  commitCount: number; demoImages: string[];
}

// ── github api ────────────────────────────────────────────────────────────────

async function ghGet(path: string, token: string): Promise<any> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "gitzette.online",
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${path}`);
  return res.json();
}

async function getReadmeImages(owner: string, repo: string, token: string, newspaperifyUrl: string, secret: string): Promise<string[]> {
  try {
    const readme = await ghGet(`/repos/${owner}/${repo}/readme`, token);
    const content = atob(readme.content.replace(/\n/g, ""));
    const defaultBranch = "main";
    const matches = [...content.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
    const skipPatterns = [/shields\.io/, /badge/i, /codecov/, /actions/, /img\.shields/, /badgen/, /\.gif$/i];
    const images: string[] = [];
    for (const [, alt, url] of matches) {
      if (skipPatterns.some(p => p.test(url) || p.test(alt))) continue;
      let resolved = url;
      if (!url.startsWith("http")) {
        resolved = `https://raw.githubusercontent.com/${owner}/${repo}/${defaultBranch}/${url.replace(/^\.\//, "")}`;
      }
      try {
        const npRes = await fetch(`${newspaperifyUrl}?url=${encodeURIComponent(resolved)}&secret=${secret}`);
        if (npRes.ok) {
          const data: any = await npRes.json();
          if (data.image) { images.push(data.image); break; }
        }
      } catch { /* skip */ }
    }
    return images.slice(0, 1);
  } catch { return []; }
}

async function getRepoData(owner: string, repo: string, from: Date, to: Date, token: string, newspaperifyUrl: string, secret: string): Promise<RepoData | null> {
  try {
    const info = await ghGet(`/repos/${owner}/${repo}`, token);
    const allReleases = await ghGet(`/repos/${owner}/${repo}/releases?per_page=20`, token);
    const releases: Release[] = allReleases
      .filter((r: any) => { const d = new Date(r.published_at); return d >= from && d <= to; })
      .map((r: any) => ({ tag: r.tag_name, name: r.name || r.tag_name, date: r.published_at, body: (r.body || "").slice(0, 2000), url: r.html_url }));

    const allPRs = await ghGet(`/repos/${owner}/${repo}/pulls?state=closed&per_page=50&sort=updated&direction=desc`, token);
    const mergedPRs: PR[] = allPRs
      .filter((p: any) => { if (!p.merged_at) return false; const d = new Date(p.merged_at); return d >= from && d <= to; })
      .map((p: any) => ({ number: p.number, title: p.title, state: "merged" as const, date: p.merged_at, url: p.html_url, author: p.user?.login || "unknown" }));

    const openPRsRaw = await ghGet(`/repos/${owner}/${repo}/pulls?state=open&per_page=50&sort=created&direction=desc`, token);
    const openPRs: PR[] = openPRsRaw
      .filter((p: any) => { const d = new Date(p.created_at); return d >= from && d <= to; })
      .map((p: any) => ({ number: p.number, title: p.title, state: "open" as const, date: p.created_at, url: p.html_url, author: p.user?.login || "unknown" }));

    let commitCount = 0;
    try {
      const commits = await ghGet(`/repos/${owner}/${repo}/commits?since=${from.toISOString()}&until=${to.toISOString()}&per_page=100`, token);
      commitCount = Array.isArray(commits) ? commits.length : 0;
    } catch { /* empty repo */ }

    if (releases.length === 0 && mergedPRs.length === 0 && commitCount === 0) return null;

    const demoImages = await getReadmeImages(owner, repo, token, newspaperifyUrl, secret);

    return { name: repo, description: info.description, url: info.html_url, stars: info.stargazers_count ?? 0, releases, mergedPRs, openPRs, commitCount, demoImages };
  } catch (err) {
    console.error(`skipping ${repo}:`, err);
    return null;
  }
}

// ── image generation ──────────────────────────────────────────────────────────

async function generateIllustration(subject: string, openAiKey: string, r2: R2Bucket, username: string): Promise<string | null> {
  const STYLE = "Victorian-era woodcut engraving with detailed cross-hatching. PORTRAIT orientation — taller than wide. Pure black ink lines on pure white background. NO background shading, NO dark fills, NO border, NO frame, NO text or labels. CRITICAL: the object must have a COMPLEX IRREGULAR SILHOUETTE. Subject: ";
  const prompt = STYLE + subject;
  try {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "Authorization": `Bearer ${openAiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-image-1", prompt, n: 1, size: "1024x1024", background: "transparent", output_format: "png" }),
    });
    const data: any = await res.json();
    if (!data.data?.[0]?.b64_json) return null;
    const buf = Uint8Array.from(atob(data.data[0].b64_json), c => c.charCodeAt(0));
    // store in R2 under illustrations/
    const slug = subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
    const key = `illustrations/${slug}.png`;
    await r2.put(key, buf, { httpMetadata: { contentType: "image/png" } });
    return `https://gitzette.online/img/${slug}.png`;
  } catch (e) { console.warn("illustration error:", e); }
  return null;
}

// ── llm copy ──────────────────────────────────────────────────────────────────

async function generateCopy(reposData: RepoData[], from: Date, to: Date, owner: string, orKey: string): Promise<any> {
  const dataJson = JSON.stringify(
    reposData.map(r => ({
      repo: r.name, description: r.description,
      releases: r.releases.map(rel => ({ tag: rel.tag, date: rel.date, highlights: rel.body.slice(0, 2000) })),
      mergedPRs: r.mergedPRs.slice(0, 10).map(p => ({ title: p.title, url: p.url, number: p.number })),
      openPRs: r.openPRs.slice(0, 5).map(p => ({ title: p.title, url: p.url, number: p.number })),
      commitCount: r.commitCount,
    })), null, 2
  );
  const fromLabel = from.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  const toLabel = to.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const prompt = `You are writing the editorial copy for a weekly engineering newspaper called "the dispatch" — a digest of GitHub activity by @${owner}.

Week of ${fromLabel} – ${toLabel}.

VOICE: You are writing for a technical audience of software engineers who have seen it all. They appreciate dry wit, specific technical jokes, and copy that treats them as intelligent adults. Think: The Economist meets lobste.rs. Never explain the joke. Never say "innovative" or "robust". Be specific, be wry, be smart.

STYLE RULES:
- Punchy headlines with dry wit — but wit must come from the actual technical content, not wordplay
- Strict with facts: never invent numbers, dates, or features not in the data
- Headlines: deeply specific, not generic. "rpg teaches EXPLAIN to read its own X-rays" not "rpg gets new features"
- Short sentences. Active voice. No emoji. No markdown (no **bold**, no backticks).
- Always call the author "@${owner}" — never full name or "the developer"
- Project names always lowercase: "rpg" not "RPG", "sqlever" not "Sqlever"
- When mentioning PRs, use inline HTML links: <a href="URL">#NUMBER</a>
- Tagline: something wry and specific to this week's theme, not generic. Make it sound like a film logline.
- editionNote: one surprising sentence that captures the spirit of this week. Include a dry observation.
- Article bodies: mix the technical detail with one sardonic observation. Don't belabor it.
- Headlines must be about the work, not meta-commentary about the author's habits. No "takes no questions", "doesn't sleep", "ships quietly".

DATA:
${dataJson}

Return ONLY a JSON object (no markdown fences):
{
  "masthead": "the dispatch",
  "tagline": "witty one-line tagline specific to this week",
  "editionNote": "one sentence: e.g. 'Four releases, one leaked key, and a migration tool that arrived fully armed.'",
  "articles": [
    {
      "repo": "repo name",
      "headline": "punchy newspaper headline",
      "deck": "one-sentence italic subheading",
      "body": "2-4 sentence article body with specific features/PRs. Inline HTML links ok.",
      "tag": "RELEASE | FEATURE | SECURITY | PENDING | COMMUNITY",
      "illustrationPrompt": "10-15 word subject for editorial illustration (only if repo has no screenshots)"
    }
  ],
  "closingNote": "dry one-liner sign-off"
}`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${orKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "anthropic/claude-opus-4-5",
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter error: ${await res.text()}`);
  const data: any = await res.json();
  const raw = (data.choices[0].message.content ?? "").trim().replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
  try { return JSON.parse(raw); } catch {
    const m = raw.match(/\{[\s\S]+\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error(`LLM non-JSON: ${raw.slice(0, 200)}`);
  }
}

// ── data graphics ─────────────────────────────────────────────────────────────

function buildDataGraphics(reposData: RepoData[], from: Date, to: Date): string {
  const totalMerged = reposData.reduce((s, r) => s + r.mergedPRs.length, 0);
  const totalOpen = reposData.reduce((s, r) => s + r.openPRs.length, 0);
  const totalCommits = reposData.reduce((s, r) => s + r.commitCount, 0);
  const totalReleases = reposData.reduce((s, r) => s + r.releases.length, 0);
  const activeRepos = reposData.filter(r => r.commitCount > 0);
  const maxCommits = Math.max(...activeRepos.map(r => r.commitCount), 1);

  const ticker = `<div style="display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--rule);margin-bottom:20px;">
    ${[[String(totalCommits),"commits"],[String(totalMerged+totalOpen),"pull requests"],[String(totalReleases),"releases"]]
      .map(([val,label],i) => `<div style="padding:14px 10px 12px;${i<2?"border-right:1px solid var(--rule);":""}text-align:center;">
        <div style="font-family:'IBM Plex Mono',monospace;font-size:clamp(28px,8vw,52px);font-weight:700;line-height:1;color:#333;">${val}</div>
        <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-top:4px;">${label}</div>
      </div>`).join("")}
  </div>`;

  const sorted = [...activeRepos].sort((a,b) => b.commitCount - a.commitCount);
  const barH=18,barGap=7,labelW=110,chartW=240,numW=32;
  const svgW=labelW+chartW+numW, svgH=sorted.length*(barH+barGap)+22;
  const greys=["#555","#888","#999","#aaa","#bbb","#ccc","#ddd"];
  const bars = sorted.map((r,i) => {
    const bw = Math.max(3, Math.round((r.commitCount/maxCommits)*chartW));
    const y = i*(barH+barGap)+18;
    const fill = greys[Math.min(i,greys.length-1)];
    return `<text x="${labelW-6}" y="${y+barH-4}" text-anchor="end" font-family="IBM Plex Mono,monospace" font-size="10" fill="${i===0?"#333":"#666"}" font-weight="${i===0?"600":"400"}">${r.name}</text>
    <rect x="${labelW}" y="${y}" width="${bw}" height="${barH}" fill="${fill}" rx="1"/>
    <text x="${labelW+bw+5}" y="${y+barH-4}" font-family="IBM Plex Mono,monospace" font-size="10" fill="#888">${r.commitCount}</text>`;
  }).join("");

  const commitChart = `<div style="margin-bottom:20px;">
    <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:8px;">commits by repo</div>
    <svg width="100%" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
      <text x="0" y="11" font-family="IBM Plex Mono,monospace" font-size="8" fill="#ccc" letter-spacing="1">REPO</text>
      <text x="${svgW}" y="11" font-family="IBM Plex Mono,monospace" font-size="8" fill="#ccc" text-anchor="end" letter-spacing="1">COMMITS</text>
      <line x1="0" y1="14" x2="${svgW}" y2="14" stroke="#e8e4dc" stroke-width="0.5"/>
      ${bars}
    </svg>
  </div>`;

  const starredRepos = [...reposData].filter(r=>r.stars>0).sort((a,b)=>b.stars-a.stars);
  const maxStars = Math.max(...starredRepos.map(r=>r.stars),1);
  const STAR_COLS=10;
  const starRows = starredRepos.map(r => {
    const filled = Math.max(1,Math.round((r.stars/maxStars)*STAR_COLS));
    const empty = STAR_COLS-filled;
    return `<tr style="border-bottom:1px solid var(--rule);">
      <td style="font-family:'IBM Plex Mono',monospace;font-size:11px;padding:10px 12px 10px 0;white-space:nowrap;vertical-align:middle;"><a href="${r.url}" style="color:var(--ink);text-decoration:none;">${r.name}</a></td>
      <td style="font-family:'IBM Plex Mono',monospace;font-size:36px;letter-spacing:4px;line-height:1;vertical-align:middle;padding:12px 14px 12px 0;">${"★".repeat(filled)}<span style="color:#ddd;">${"☆".repeat(empty)}</span></td>
      <td style="font-family:'IBM Plex Mono',monospace;font-size:28px;font-weight:700;color:var(--ink);white-space:nowrap;vertical-align:middle;text-align:right;padding:12px 0;">${r.stars.toLocaleString()}</td>
    </tr>`;
  }).join("");
  const starLeaderboard = starredRepos.length > 0 ? `<div style="margin-bottom:20px;">
    <div style="font-family:'IBM Plex Mono',monospace;font-size:9px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:8px;">github stars</div>
    <table style="width:100%;border-collapse:collapse;">${starRows}</table>
  </div>` : "";

  return `<div style="font-family:'IBM Plex Mono',monospace;">${ticker}${commitChart}${starLeaderboard}</div>`;
}

// ── article image helper ──────────────────────────────────────────────────────

function articleImg(src: string, alt: string, isIllustration: boolean): string {
  if (isIllustration) {
    // woodcut illustration: float right with shape-outside
    return `<div style="float:right;margin:0 0 8px 16px;width:180px;shape-outside:url('${src}');-webkit-shape-outside:url('${src}');">
      <img src="${src}" style="width:180px;display:block;" alt="${alt}">
    </div>`;
  }
  // screenshot: float right, max 45% width, border
  return `<div style="float:right;margin:0 0 8px 16px;max-width:45%;">
    <img src="${src}" style="width:100%;display:block;border:1px solid var(--rule);" alt="${alt}">
  </div>`;
}

// ── html builder ──────────────────────────────────────────────────────────────

function buildHtml(copy: any, reposData: RepoData[], owner: string, from: Date, to: Date, weekKey: string, illustratedRepos: Set<string> = new Set()): string {
  const fromLabel = from.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const toLabel = to.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const totalCommits = reposData.reduce((s,r)=>s+r.commitCount,0);
  const totalMerged = reposData.reduce((s,r)=>s+r.mergedPRs.length,0);
  const totalReleases = reposData.reduce((s,r)=>s+r.releases.length,0);

  const articleHtml = (copy.articles ?? []).map((a: any, i: number) => {
    const repo = reposData.find(r => r.name === a.repo);
    const img = repo?.demoImages?.[0];
    const releaseLinks = repo?.releases.slice(0,4).map((r: Release) =>
      `<a href="${r.url}" style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:600;color:var(--ink);border-bottom:none;margin-right:8px;">${r.tag}</a><span style="color:var(--muted);font-size:11px;margin-right:12px;">${new Date(r.date).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}</span>`
    ).join("") ?? "";
    const prLinks = repo?.mergedPRs.slice(0,6).map((p: PR) =>
      `<a href="${p.url}" style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ink);margin-right:6px;border-bottom:1px solid var(--rule);">#${p.number}</a>`
    ).join("") ?? "";

    return `<div style="margin-bottom:32px;padding-bottom:32px;border-bottom:1px solid var(--rule);">
      <div style="display:inline-block;background:var(--ink);color:var(--paper);font-family:'IBM Plex Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.12em;padding:2px 6px;margin-bottom:8px;">${a.tag}</div>
      <h2 style="font-family:'IBM Plex Serif',Georgia,serif;font-size:clamp(18px,4vw,26px);font-weight:700;line-height:1.2;margin-bottom:6px;"><a href="${repo?.url??'#'}" style="color:var(--ink);text-decoration:none;">${a.headline}</a></h2>
      <p style="font-family:'IBM Plex Serif',Georgia,serif;font-style:italic;font-size:14px;color:var(--muted);margin-bottom:10px;">${a.deck}</p>
      ${img ? articleImg(img, a.repo, illustratedRepos.has(a.repo)) : ""}
      <p style="font-family:'IBM Plex Serif',Georgia,serif;font-size:15px;line-height:1.65;margin-bottom:8px;">${a.body}</p>
      <div style="clear:both;"></div>
      ${releaseLinks ? `<div style="margin-top:8px;color:var(--muted);">${releaseLinks}</div>` : ""}
      ${prLinks ? `<div style="margin-top:4px;font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--muted);">merged: ${prLinks}</div>` : ""}
    </div>`;
  }).join("");

  const splitAt = Math.ceil((copy.articles??[]).length / 2);
  const articles1 = (copy.articles??[]).slice(0, splitAt).map((_: any, i: number) => {
    const repo = reposData.find(r => r.name === copy.articles[i].repo);
    const a = copy.articles[i];
    const img = repo?.demoImages?.[0];
    const releaseLinks = repo?.releases.slice(0,4).map((r: Release) =>
      `<a href="${r.url}" style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:600;color:var(--ink);border-bottom:none;margin-right:8px;">${r.tag}</a><span style="color:var(--muted);font-size:11px;margin-right:12px;">${new Date(r.date).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}</span>`
    ).join("") ?? "";
    const prLinks = repo?.mergedPRs.slice(0,6).map((p: PR) =>
      `<a href="${p.url}" style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ink);margin-right:6px;border-bottom:1px solid var(--rule);">#${p.number}</a>`
    ).join("") ?? "";
    return `<div style="margin-bottom:32px;padding-bottom:32px;border-bottom:1px solid var(--rule);">
      <div style="display:inline-block;background:var(--ink);color:var(--paper);font-family:'IBM Plex Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.12em;padding:2px 6px;margin-bottom:8px;">${a.tag}</div>
      <h2 style="font-family:'IBM Plex Serif',Georgia,serif;font-size:clamp(18px,4vw,26px);font-weight:700;line-height:1.2;margin-bottom:6px;"><a href="${repo?.url??'#'}" style="color:var(--ink);text-decoration:none;">${a.headline}</a></h2>
      <p style="font-family:'IBM Plex Serif',Georgia,serif;font-style:italic;font-size:14px;color:var(--muted);margin-bottom:10px;">${a.deck}</p>
      ${img ? articleImg(img, a.repo, illustratedRepos.has(a.repo)) : ""}
      <p style="font-family:'IBM Plex Serif',Georgia,serif;font-size:15px;line-height:1.65;margin-bottom:8px;">${a.body}</p>
      <div style="clear:both;"></div>
      ${releaseLinks ? `<div style="margin-top:8px;color:var(--muted);">${releaseLinks}</div>` : ""}
      ${prLinks ? `<div style="margin-top:4px;font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--muted);">merged: ${prLinks}</div>` : ""}
    </div>`;
  }).join("");

  const articles2 = (copy.articles??[]).slice(splitAt).map((_: any, ii: number) => {
    const i = splitAt + ii;
    const a = copy.articles[i];
    const repo = reposData.find(r => r.name === a.repo);
    const img = repo?.demoImages?.[0];
    const releaseLinks = repo?.releases.slice(0,4).map((r: Release) =>
      `<a href="${r.url}" style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:600;color:var(--ink);border-bottom:none;margin-right:8px;">${r.tag}</a><span style="color:var(--muted);font-size:11px;margin-right:12px;">${new Date(r.date).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}</span>`
    ).join("") ?? "";
    const prLinks = repo?.mergedPRs.slice(0,6).map((p: PR) =>
      `<a href="${p.url}" style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ink);margin-right:6px;border-bottom:1px solid var(--rule);">#${p.number}</a>`
    ).join("") ?? "";
    return `<div style="margin-bottom:32px;padding-bottom:32px;border-bottom:1px solid var(--rule);">
      <div style="display:inline-block;background:var(--ink);color:var(--paper);font-family:'IBM Plex Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.12em;padding:2px 6px;margin-bottom:8px;">${a.tag}</div>
      <h2 style="font-family:'IBM Plex Serif',Georgia,serif;font-size:clamp(18px,4vw,26px);font-weight:700;line-height:1.2;margin-bottom:6px;"><a href="${repo?.url??'#'}" style="color:var(--ink);text-decoration:none;">${a.headline}</a></h2>
      <p style="font-family:'IBM Plex Serif',Georgia,serif;font-style:italic;font-size:14px;color:var(--muted);margin-bottom:10px;">${a.deck}</p>
      ${img ? articleImg(img, a.repo, illustratedRepos.has(a.repo)) : ""}
      <p style="font-family:'IBM Plex Serif',Georgia,serif;font-size:15px;line-height:1.65;margin-bottom:8px;">${a.body}</p>
      <div style="clear:both;"></div>
      ${releaseLinks ? `<div style="margin-top:8px;color:var(--muted);">${releaseLinks}</div>` : ""}
      ${prLinks ? `<div style="margin-top:4px;font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--muted);">merged: ${prLinks}</div>` : ""}
    </div>`;
  }).join("");

  const dataGraphics = buildDataGraphics(reposData, from, to);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<title>${owner} — gitzette ${weekKey}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:ital,wght@0,400;0,600;0,700;1,400&family=IBM+Plex+Serif:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root { --ink: #0f0f0f; --paper: #f7f4ee; --rule: #c8c2b4; --muted: #666; }
  body { background: #e8e4dc; font-family: 'IBM Plex Sans', sans-serif; color: var(--ink); font-size: 15px; line-height: 1.6; }
  a { color: var(--ink); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .paper { max-width: 960px; margin: 24px auto; background: var(--paper); border: 1px solid var(--rule); box-shadow: 0 2px 12px rgba(0,0,0,.15); }
  .header { padding: 20px 24px 14px; border-bottom: 3px solid var(--ink); }
  .kicker { font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; border-bottom: 1px solid var(--rule); padding-bottom: 8px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: baseline; }
  .kicker a { color: var(--ink); border-bottom: 1px solid var(--ink); }
  .masthead { font-family: 'IBM Plex Mono', monospace; font-weight: 700; font-size: clamp(32px,7vw,64px); letter-spacing: -.03em; line-height: 1; }
  .masthead span { color: var(--muted); font-weight: 400; }
  .username { font-family: 'IBM Plex Mono', monospace; font-size: 20px; font-weight: 700; margin-top: 4px; }
  .tagline { font-family: 'IBM Plex Serif', serif; font-style: italic; font-size: 14px; color: var(--muted); margin-top: 6px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .edition-bar { display: flex; gap: 16px; padding: 8px 24px; border-bottom: 1px solid var(--rule); background: var(--ink); flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
  .edition-bar::-webkit-scrollbar { display: none; }
  .edition-stat { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--paper); white-space: nowrap; }
  .body { padding: 0 24px 32px; }
  .grid-2-1 { display: grid; grid-template-columns: 2fr 1fr; gap: 32px; padding-top: 24px; }
  @media (max-width: 700px) { .grid-2-1 { grid-template-columns: 1fr; } .grid-2-1 .col:last-child { display: none; } }
  .articles-p2 { display: block; }
  @media (min-width: 1400px) {
    body { background: #d8d4cc; }
    .broadsheet-wrap { display: flex; align-items: flex-start; max-width: 1900px; margin: 32px auto; }
    .broadsheet-wrap .paper { max-width: none; flex: 1; margin: 0; }
    .broadsheet-wrap .paper.page-2 { display: block; border-left: 3px double var(--rule); margin-left: -1px; }
    .broadsheet-wrap .paper:first-child .articles-p2 { display: none; }
    .broadsheet-wrap .paper:first-child .grid-2-1 { grid-template-columns: 1fr; }
    .broadsheet-wrap .paper:first-child .grid-2-1 .col:last-child { display: none; }
  }
  .page-2 { display: none; }
  .footer { padding: 12px 24px; border-top: 1px solid var(--rule); font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--muted); display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
</style>
</head>
<body>
<div class="broadsheet-wrap">
<div class="paper">
  <div class="header">
    <div class="kicker">
      <span><a href="https://gitzette.online">gitzette.online</a> — open-source digest</span>
      <span style="color:var(--muted);font-weight:400;">${fromLabel} – ${toLabel}</span>
    </div>
    <div class="masthead">the <span>dispatch</span></div>
    <div class="username">@${owner}</div>
    <div class="tagline">${copy.tagline ?? ""}</div>
  </div>
  <div class="edition-bar">
    <span class="edition-stat">${totalCommits} commits</span>
    <span class="edition-stat">${totalMerged} PRs merged</span>
    <span class="edition-stat">${totalReleases} releases</span>
    <span class="edition-stat">${reposData.length} repos</span>
    <span class="edition-stat">${copy.editionNote ?? ""}</span>
  </div>
  <div class="body">
    <div class="grid-2-1">
      <div class="col">
        ${articles1}
        <div class="articles-p2">${articles2}</div>
      </div>
      <div class="col">${dataGraphics}</div>
    </div>
  </div>
  <div class="footer">
    <span>gitzette.online/${owner}</span>
    <span style="color:var(--rule);">·</span>
    <span>${copy.closingNote ?? "generated from public github activity"}</span>
    <span style="color:var(--rule);">·</span>
    <span>${weekKey}</span>
  </div>
</div>
<div class="paper page-2">
  <div class="header">
    <div class="kicker"><span>continued</span><span style="color:var(--muted);">${weekKey}</span></div>
    <div class="masthead" style="font-size:32px;">the <span>dispatch</span></div>
  </div>
  <div class="body" style="padding-top:24px;">
    <div class="articles-p2">${articles2}</div>
    <div style="margin-top:32px;">${dataGraphics}</div>
  </div>
</div>
</div>
</body>
</html>`;
}

// ── week key helper ───────────────────────────────────────────────────────────

function weekKey(d: Date): string {
  const aoe = new Date(d.getTime() - 12 * 60 * 60 * 1000);
  const thu = new Date(aoe);
  thu.setUTCDate(aoe.getUTCDate() - ((aoe.getUTCDay() + 6) % 7) + 3);
  const y = thu.getUTCFullYear();
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const mon1 = new Date(jan4);
  mon1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  return `${y}-W${String(Math.floor((thu.getTime() - mon1.getTime()) / (7 * 86400000)) + 1).padStart(2, "0")}`;
}

// ── main generation pipeline ──────────────────────────────────────────────────

async function runGeneration(env: Env, user: { id: string; username: string }): Promise<number> {
  const to = new Date();
  // Snap from= to Monday 00:00 AoE (= Monday 12:00 UTC)
  const AOE_MS = 12 * 60 * 60 * 1000;
  const nowAoE = new Date(Date.now() - AOE_MS);
  const dayOfWeek = (nowAoE.getUTCDay() + 6) % 7; // Mon=0…Sun=6
  const mondayAoE = new Date(nowAoE);
  mondayAoE.setUTCDate(nowAoE.getUTCDate() - dayOfWeek);
  mondayAoE.setUTCHours(0, 0, 0, 0);
  const from = new Date(mondayAoE.getTime() + AOE_MS);

  const npUrl = (env as any).NEWSPAPERIFY_URL ?? "https://test-callbot.samo.team/newspaperify";
  const npSecret = (env as any).NEWSPAPERIFY_SECRET ?? "";

  // list public repos
  console.log(`[gen] ${user.username}: fetching repos`);
  const allRepos = await ghGet(`/users/${user.username}/repos?per_page=100&sort=pushed`, env.GITHUB_TOKEN);
  const repoNames: string[] = allRepos
    .filter((r: any) => !r.private && !r.fork)
    .map((r: any) => r.name)
    .slice(0, 8); // keep under CF Workers free-plan 50-subrequest limit (~8 repos × 6 calls = 48)
  console.log(`[gen] ${user.username}: ${repoNames.length} repos`);

  if (repoNames.length === 0) {
    await saveDispatch(env.DB, user.id, user.username, "<p>No public repos found.</p>", from, to);
    return 0;
  }

  // fetch repo data in parallel (batches of 5 to avoid rate limits)
  const reposData: RepoData[] = [];
  for (let i = 0; i < repoNames.length; i += 5) {
    const batch = repoNames.slice(i, i + 5);
    console.log(`[gen] ${user.username}: batch ${i}-${i+batch.length}`);
    const results = await Promise.all(
      batch.map(repo => getRepoData(user.username, repo, from, to, env.GITHUB_TOKEN, npUrl, npSecret))
    );
    reposData.push(...results.filter((r): r is RepoData => r !== null));
  }
  console.log(`[gen] ${user.username}: ${reposData.length} active repos`);

  if (reposData.length === 0) {
    await saveDispatch(env.DB, user.id, user.username, "<p>No activity this week.</p>", from, to);
    return 0;
  }

  // generate LLM copy
  console.log(`[gen] ${user.username}: calling LLM`);
  const copy = await generateCopy(reposData, from, to, user.username, env.OPENROUTER_API_KEY);
  console.log(`[gen] ${user.username}: LLM done`);

  // generate AI illustrations for articles without screenshots
  const illustratedRepos = new Set<string>();
  const openAiKey = (env as any).OPENAI_API_KEY;
  if (openAiKey) {
    for (const article of (copy.articles ?? [])) {
      const repo = reposData.find((r: RepoData) => r.name === article.repo);
      if (repo && repo.demoImages.length === 0 && article.illustrationPrompt) {
        const img = await generateIllustration(article.illustrationPrompt, openAiKey, env.DISPATCHES, user.username);
        if (img) { repo.demoImages.push(img); illustratedRepos.add(repo.name); }
      }
    }
  }

  // build HTML
  const wk = weekKey(to);
  const html = buildHtml(copy, reposData, user.username, from, to, wk, illustratedRepos);

  // save
  console.log(`[gen] ${user.username}: saving dispatch wk=${wk}`);
  await saveDispatch(env.DB, env.DISPATCHES, user.id, user.username, html, from, to);
  console.log(`[gen] ${user.username}: done`);

  // rough cost estimate: ~3K tokens LLM + images
  const llmCost = 0.003;
  const imageCost = reposData.length * 0.03;
  return llmCost + imageCost;
}

async function saveDispatch(db: D1Database, r2: R2Bucket, userId: string, username: string, html: string, _from: Date, to: Date): Promise<void> {
  const aoe = new Date(to.getTime() - 12 * 60 * 60 * 1000);
  const thu = new Date(aoe);
  thu.setUTCDate(aoe.getUTCDate() - ((aoe.getUTCDay() + 6) % 7) + 3);
  const y = thu.getUTCFullYear();
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const mon1 = new Date(jan4);
  mon1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const wk = `${y}-W${String(Math.floor((thu.getTime() - mon1.getTime()) / (7 * 86400000)) + 1).padStart(2, "0")}`;
  const r2Key = `dispatches/${username}/${wk}.html`;

  // store HTML in R2
  await r2.put(r2Key, html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });

  // store metadata in D1 — delete generating sentinel, insert real row
  await db.prepare(`DELETE FROM dispatches WHERE user_id=? AND week_key='generating'`).bind(userId).run();
  await db.prepare(
    `INSERT INTO dispatches (user_id, week_key, r2_key, generated_at) VALUES (?, ?, ?, unixepoch())
     ON CONFLICT(user_id, week_key) DO UPDATE SET r2_key=excluded.r2_key, generated_at=excluded.generated_at`
  ).bind(userId, wk, r2Key).run();
}
