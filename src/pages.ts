import { Hono } from "hono";
import { getUser } from "./auth";
import type { Env } from "./index";

export const pageRoutes = new Hono<{ Bindings: Env }>();

// ── helpers ───────────────────────────────────────────────────────────────────

function parseWeekKey(wk: string): { year: number; week: number } | null {
  const m = wk.match(/^(\d{4})-W(\d{1,2})$/);
  if (!m) return null;
  return { year: parseInt(m[1]), week: parseInt(m[2]) };
}

function weekKeyToRange(weekKey: string): string {
  const [year, w] = weekKey.split('-W').map(Number);
  // ISO week: Jan 4 is always in week 1
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7; // Mon=1
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (dayOfWeek - 1) + (w - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${fmt(monday)} – ${fmt(sunday)}`;
}

function adjacentWeekKey(wk: string, delta: number): string {
  const p = parseWeekKey(wk);
  if (!p) return "";
  // approximate: each week = 7 days from ISO week Monday
  const jan4 = new Date(p.year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const weekStart = new Date(jan4);
  weekStart.setDate(jan4.getDate() - dayOfWeek + 1 + (p.week - 1) * 7 + delta * 7);
  const y = weekStart.getFullYear();
  // ISO week number
  const jan4b = new Date(y, 0, 4);
  const dow = jan4b.getDay() || 7;
  const wkStart = new Date(jan4b);
  wkStart.setDate(jan4b.getDate() - dow + 1);
  const diff = Math.round((weekStart.getTime() - wkStart.getTime()) / (7 * 86400000));
  const w = diff + 1;
  return `${y}-W${String(w).padStart(2, "0")}`;
}

function currentWeekKey(): string {
  const now = new Date();
  const jan4 = new Date(now.getFullYear(), 0, 4);
  const dow = jan4.getDay() || 7;
  const wkStart = new Date(jan4);
  wkStart.setDate(jan4.getDate() - dow + 1);
  const diff = Math.round((now.getTime() - wkStart.getTime()) / (7 * 86400000));
  return `${now.getFullYear()}-W${String(diff + 1).padStart(2, "0")}`;
}

function weekNavBar(username: string, week_key: string, prevExists?: boolean, nextExists?: boolean): string {
  const prev = adjacentWeekKey(week_key, -1);
  const next = adjacentWeekKey(week_key, 1);
  const isFuture = next >= currentWeekKey();
  const short = (wk: string) => wk.replace(/^\d{4}-/, ""); // "W13"
  // prevExists/nextExists: if provided, only show nav for known weeks; default to showing both
  const showPrev = prevExists !== false;
  const showNext = nextExists !== false && !isFuture;
  const navLinkStyle = "color:#f7f4ee;text-decoration:none;border:1px solid #555;padding:3px 8px;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.04em;";
  const navLinkHover = "onmouseover=\"this.style.borderColor='#aaa';this.style.color='#fff'\" onmouseout=\"this.style.borderColor='#555';this.style.color='#f7f4ee'\"";
  return `<span style="display:flex;align-items:center;gap:6px;white-space:nowrap;">
    ${showPrev
      ? `<a href="/${username}/${prev}" style="${navLinkStyle}" ${navLinkHover}>← ${short(prev)}</a>`
      : `<span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#444;border:1px solid #333;padding:3px 8px;">← ${short(prev)}</span>`
    }
    <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:600;color:#f7f4ee;padding:3px 6px;">${short(week_key)}</span>
    ${showNext
      ? `<a href="/${username}/${next}" style="${navLinkStyle}" ${navLinkHover}>${short(next)} →</a>`
      : `<span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#444;border:1px solid #333;padding:3px 8px;">${short(next)} →</span>`
    }
  </span>`;
}

function headTags(): string {
  return `<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%230f0f0f'/><text x='3' y='26' font-size='26' fill='%23f7f4ee' font-family='Georgia,serif' font-weight='700'>G</text></svg>">
<meta name="theme-color" content="#0f0f0f">`;
}

function creatorFooter(): string {
  return `<div style="background:#0f0f0f;padding:10px 24px;text-align:center;font-family:'IBM Plex Mono',monospace;font-size:11px;color:#888;">
    built by <a href="https://github.com/NikolayS" style="color:#ccc;text-decoration:none;border:none;">@NikolayS</a>
    &nbsp;·&nbsp;
    <a href="https://gitzette.online" style="color:#ccc;text-decoration:none;border:none;">gitzette.online</a>
  </div>`;
}

function dispatchFooter(username: string, week_key: string, prevWeekKey?: string | null, nextWeekKey?: string | null): string {
  const url = `https://gitzette.online/${username}/${week_key}`;
  const tweetText = encodeURIComponent(`This week in open source: @${username}'s dispatch — ${url}`);
  const xUrl = `https://twitter.com/intent/tweet?text=${tweetText}`;
  const liUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
  const isFuture = nextWeekKey && nextWeekKey >= currentWeekKey();
  // Footer week nav — only show links for weeks that exist (passed as params)
  const prevLink = prevWeekKey
    ? `<a href="/${username}/${prevWeekKey}" style="color:#0f0f0f;text-decoration:none;border:1px solid #c8c2b4;padding:5px 12px;font-family:'IBM Plex Mono',monospace;font-size:12px;" onmouseover="this.style.borderColor='#0f0f0f'" onmouseout="this.style.borderColor='#c8c2b4'">← ${weekKeyToRange(prevWeekKey)}</a>`
    : "";
  const nextLink = (nextWeekKey && !isFuture)
    ? `<a href="/${username}/${nextWeekKey}" style="color:#0f0f0f;text-decoration:none;border:1px solid #c8c2b4;padding:5px 12px;font-family:'IBM Plex Mono',monospace;font-size:12px;" onmouseover="this.style.borderColor='#0f0f0f'" onmouseout="this.style.borderColor='#c8c2b4'">${weekKeyToRange(nextWeekKey)} →</a>`
    : "";
  const weekNavRow = (prevLink || nextLink) ? `
    <!-- Week nav row -->
    <div style="max-width:900px;margin:0 auto;padding:16px 24px 8px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center;">
      ${prevLink}
      ${nextLink}
    </div>` : "";
  return `
  <div style="background:#f7f4ee;border-top:1px solid #c8c2b4;">
    ${weekNavRow}
    <!-- Row 1: Navigation links — left-aligned, ink, underlined -->
    <div style="max-width:900px;margin:0 auto;padding:14px 24px 6px;font-family:'IBM Plex Mono',monospace;font-size:12px;display:flex;flex-wrap:wrap;gap:4px 20px;align-items:center;">
      <a href="/" style="color:#0f0f0f;text-decoration:underline;">gitzette</a>
      <a href="/${username}" style="color:#0f0f0f;text-decoration:underline;">@${username} on gitzette</a>
      <a href="https://github.com/${username}" target="_blank" rel="noopener" style="color:#0f0f0f;text-decoration:underline;">@${username} on GitHub</a>
    </div>
    <!-- Row 2: Share links — muted, right-aligned on desktop / left-aligned on mobile (#52) -->
    <div style="max-width:900px;margin:0 auto;padding:6px 24px 14px;font-family:'IBM Plex Mono',monospace;font-size:12px;display:flex;flex-wrap:wrap;gap:4px 20px;align-items:center;color:#888;">
      <span>share:</span>
      <a href="${xUrl}" target="_blank" rel="noopener" style="color:#888;text-decoration:none;padding:8px 0;min-height:44px;display:inline-flex;align-items:center;">post on X</a>
      <a href="${liUrl}" target="_blank" rel="noopener" style="color:#888;text-decoration:none;padding:8px 0;min-height:44px;display:inline-flex;align-items:center;">share on LinkedIn</a>
    </div>
  </div>
  ${ctaFooter()}
  ${creatorFooter()}`;
}

function ctaFooter(): string {
  // Solid CTA block — dark background so the white/paper button pops.
  // Uses width:min(100%,420px) for full-width on mobile without a media query.
  return `<div style="background:#0f0f0f;padding:40px 24px 44px;text-align:center;font-family:'IBM Plex Mono',monospace;">
    <p style="color:#666;font-size:12px;letter-spacing:.04em;margin:0 0 20px;">Show your work, without writing about it.</p>
    <a href="/auth/github"
       style="display:inline-block;background:#f7f4ee;color:#0f0f0f;font-family:'IBM Plex Mono',monospace;font-size:15px;font-weight:700;letter-spacing:.02em;text-decoration:none;padding:16px 40px;border:none;cursor:pointer;width:min(100%,420px);box-sizing:border-box;"
       onmouseover="this.style.background='#ffffff'"
       onmouseout="this.style.background='#f7f4ee'">Generate your dispatch &rarr;</a>
  </div>`;
}

// ── OG tag helpers ────────────────────────────────────────────────────────────

/** Extract text content of the first <h1> tag. */
function extractH1(html: string): string {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m) return "";
  // strip inner HTML tags
  return m[1].replace(/<[^>]+>/g, "").trim();
}

/** Extract text content of the first element with class "deck". */
function extractDeck(html: string): string {
  // match class="deck" or class="... deck ..."
  const m = html.match(/<[^>]+class="[^"]*\bdeck\b[^"]*"[^>]*>([\s\S]*?)<\/[a-z]+>/i);
  if (!m) return "";
  const text = m[1].replace(/<[^>]+>/g, "").trim();
  return text.length > 200 ? text.slice(0, 197) + "…" : text;
}

/** Extract the first <img src="..."> URL. */
function extractFirstImg(html: string): string {
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : "";
}

/**
 * Fix unclosed <a class="headline-link"> tags inside headings in legacy dispatch HTML.
 * Legacy dispatches have: <h1><a href="..." class="headline-link">text</h1>
 * Should be:              <h1><a href="..." class="headline-link">text</a></h1>
 * Fixes #49.
 */
function fixUnclosedHeadlineLinks(html: string): string {
  // Match heading tags that contain an unclosed headline-link anchor
  return html.replace(
    /(<h[123][^>]*>)(<a[^>]+class="headline-link"[^>]*>)([\s\S]*?)(<\/h[123]>)/g,
    (_match, open, anchor, text, close) => {
      // If the text already contains </a>, don't double-close
      if (text.includes("</a>")) return _match;
      return `${open}${anchor}${text}</a>${close}`;
    }
  );
}

/** Build OG + Twitter Card meta tags for a dispatch page. */
function buildDispatchOGTags(html: string, username: string, week_key: string): string {
  const title = extractH1(html) || `@${username}'s dispatch · ${week_key}`;
  const description = extractDeck(html) || `Open-source activity for @${username}, week ${week_key}.`;
  const image = extractFirstImg(html);
  const url = `https://gitzette.online/${username}/${week_key}`;

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

  return [
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    image ? `<meta property="og:image" content="${esc(image)}">` : "",
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:type" content="article">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    image ? `<meta name="twitter:image" content="${esc(image)}">` : "",
  ].filter(Boolean).join("\n");
}

async function fetchAndServeDispatch(
  c: any,
  username: string,
  week_key: string,
  r2_key: string,
  generated_at: number,
  isOwner: boolean
): Promise<Response> {
  const r2obj = await c.env.DISPATCHES.get(r2_key);
  if (!r2obj) return c.html(noDispatchPage(username, isOwner, week_key), 404);

  const html: string = await r2obj.text();

  // Query adjacent weeks to show proper nav (only for existing weeks)
  const prevKey = adjacentWeekKey(week_key, -1);
  const nextKey = adjacentWeekKey(week_key, 1);
  const [prevRow, nextRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT 1 FROM dispatches d JOIN users u ON u.id = d.user_id WHERE u.username = ? AND d.week_key = ? AND d.r2_key IS NOT NULL`
    ).bind(username, prevKey).first(),
    c.env.DB.prepare(
      `SELECT 1 FROM dispatches d JOIN users u ON u.id = d.user_id WHERE u.username = ? AND d.week_key = ? AND d.r2_key IS NOT NULL`
    ).bind(username, nextKey).first(),
  ]);
  const prevExists = !!prevRow;
  const nextExists = !!nextRow;

  const ogTags = buildDispatchOGTags(html, username, week_key);

  // Image overflow guard — injected into every served dispatch document
  const IMG_FIX_STYLE = `${ogTags}\n${headTags()}<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=Playfair+Display:ital,wght@0,700;0,900;1,700;1,900&display=swap" rel="stylesheet"><style>body img{max-width:100%!important;height:auto!important;}table{max-width:100%!important;width:100%!important;}td,th{word-break:break-word;}/* normalize old broadsheet layout (#24) */.broadsheet-wrap{display:block!important;}.broadsheet-left{display:none!important;}.broadsheet-right{width:100%!important;max-width:960px!important;margin:0 auto!important;}/* hide page-2 sidebar from old broadsheet HTML on all screen sizes */@media(min-width:1400px){.broadsheet-wrap{display:block!important;max-width:960px!important;margin:32px auto!important;}.broadsheet-wrap .paper.page-2{display:none!important;}.broadsheet-wrap .paper{flex:none!important;max-width:100%!important;margin:0!important;}}/* override legacy --link blue (#50) */body{--link:var(--ink,#0f0f0f)!important;}</style>`;

  // Fix unclosed <a class="headline-link"> tags in legacy dispatch HTML (#49)
  const processedHtml = fixUnclosedHeadlineLinks(html);

  if (processedHtml.startsWith("<!DOCTYPE") || processedHtml.startsWith("<html")) {
    const breadcrumb = `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;overflow:hidden;">
          <a href="/" style="font-family:'Playfair Display',serif;font-weight:900;font-style:italic;font-size:22px;color:#f7f4ee;text-decoration:none;line-height:1;border:none;">gitzette</a>
          <span style="color:#555;font-family:'IBM Plex Mono',monospace;font-size:13px;">/</span>
          <a href="/${username}" style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:#aaa;text-decoration:none;border:none;">@${username}</a>
          <span style="color:#555;font-family:'IBM Plex Mono',monospace;font-size:13px;">/</span>
          <span style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:#f7f4ee;font-weight:600;">${weekKeyToRange(week_key)}</span>
          <span style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#666;">${week_key.replace(/^\d{4}-/, "")}</span>
        </div>`;
    const ownerBar = isOwner
      ? `<div style="position:fixed;top:0;left:0;right:0;z-index:999;background:#0f0f0f;padding:8px 16px;display:flex;align-items:center;justify-content:space-between;font-family:'IBM Plex Mono',monospace;font-size:12px;gap:12px;flex-wrap:wrap;">
          ${breadcrumb}
          <div style="display:flex;gap:12px;align-items:center;flex-shrink:0;">
            ${weekNavBar(username, week_key, prevExists, nextExists)}
            <button style="background:none;border:1px solid #555;color:#aaa;font-family:'IBM Plex Mono',monospace;font-size:12px;padding:3px 10px;cursor:pointer;" onmouseover="this.style.borderColor='#f7f4ee';this.style.color='#f7f4ee'" onmouseout="this.style.borderColor='#555';this.style.color='#aaa'" onclick="regenerate()">regenerate</button>
          </div>
        </div>
        <div style="min-height:48px;"></div>
        <script>
        var _regenPending=false,_regenTimer=null;
        async function regenerate() {
          const btn = document.querySelector('button[onclick="regenerate()"]');
          if (!_regenPending) {
            _regenPending=true;
            btn.textContent='Sure? Click again to confirm';
            _regenTimer=setTimeout(()=>{_regenPending=false;btn.textContent='regenerate';},5000);
            return;
          }
          clearTimeout(_regenTimer);_regenPending=false;
          btn.disabled=true; btn.textContent='generating...';
          await fetch('/generate',{method:'POST'});
          let n=0;
          const iv=setInterval(async()=>{
            n++; btn.textContent='generating... ('+(n*5)+'s)';
            const s=await fetch('/generate/status').then(r=>r.json());
            if(s.status==='ready'&&s.week_key!=='generating'){clearInterval(iv);location.reload();}
            if(n>24){clearInterval(iv);btn.textContent='reload manually';}
          },5000);
        }
        </script>`
      : `<div style="position:fixed;top:0;left:0;right:0;z-index:999;background:#0f0f0f;padding:8px 16px;display:flex;align-items:center;justify-content:space-between;font-family:'IBM Plex Mono',monospace;font-size:12px;gap:12px;flex-wrap:wrap;">
          ${breadcrumb}
          <div style="flex-shrink:0;">
            ${weekNavBar(username, week_key, prevExists, nextExists)}
          </div>
        </div>
        <div style="min-height:40px;"></div>`;

    const out = processedHtml
      .replace("</head>", `${IMG_FIX_STYLE}</head>`)
      .replace("<body>", `<body>${ownerBar}`)
      .replace("</body>", `${dispatchFooter(username, week_key, prevExists ? prevKey : null, nextExists ? nextKey : null)}</body>`);
    return c.html(out);
  }

  return c.html(dispatchPage(username, { html: processedHtml, week_key, generated_at }, isOwner));
}

function userProfilePage(
  username: string,
  avatar_url: string | null,
  dispatches: { week_key: string; generated_at: number }[]
): string {
  const rows = dispatches.map(d => {
    const short = d.week_key.replace(/^\d{4}-/, "");
    const range = weekKeyToRange(d.week_key);
    return `<a href="/${username}/${d.week_key}" style="display:flex;align-items:baseline;gap:12px;padding:10px 0;border-bottom:1px solid #c8c2b4;text-decoration:none;color:#0f0f0f;font-family:'IBM Plex Mono',monospace;" onmouseover="this.style.background='#edeae2';this.style.marginLeft='-8px';this.style.paddingLeft='8px';this.style.marginRight='-8px';this.style.paddingRight='8px';" onmouseout="this.style.background='';this.style.marginLeft='';this.style.paddingLeft='0';this.style.marginRight='';this.style.paddingRight='0';">
      <span style="font-size:13px;flex:1;">${range}</span>
      <span style="font-size:10px;color:#888;">${short}</span>
      <span style="font-size:11px;color:#888;flex-shrink:0;">Read →</span>
    </a>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>@${username} — gitzette</title>
<meta property="og:title" content="@${username} on gitzette">
<meta property="og:description" content="Weekly open-source dispatches by @${username}.">
<meta property="og:url" content="https://gitzette.online/${username}">
<meta property="og:type" content="profile">
${headTags()}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=Playfair+Display:ital,wght@0,700;0,900;1,700;1,900&display=swap" rel="stylesheet">
<style>
  :root { --ink: #0f0f0f; --paper: #f7f4ee; --rule: #c8c2b4; --muted: #666; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'IBM Plex Mono', monospace; background: var(--paper); color: var(--ink); min-height: 100vh; display: flex; flex-direction: column; }
  a { color: var(--ink); text-decoration: none; }
  .top-bar { background: #0f0f0f; padding: 8px 16px; display: flex; align-items: center; gap: 10px; }
  .top-bar a { font-family: 'Playfair Display', serif; font-weight: 900; font-style: italic; font-size: 22px; color: #f7f4ee; line-height: 1; }
  .top-bar .sep { color: #555; font-family: 'IBM Plex Mono', monospace; font-size: 13px; }
  .top-bar .current { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #aaa; }
  .content { flex: 1; max-width: 760px; margin: 0 auto; padding: 40px 24px; width: 100%; }
  .profile-header { display: flex; align-items: center; gap: 16px; margin-bottom: 32px; border-bottom: 3px double var(--ink); padding-bottom: 20px; }
  .avatar { width: 48px; height: 48px; border-radius: 50%; border: 1px solid var(--rule); }
  .username { font-size: 20px; font-weight: 700; }
  .github-link { font-size: 11px; color: var(--muted); margin-top: 2px; }
  .github-link a { color: var(--muted); text-decoration: underline; }
  .dispatch-count { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin-bottom: 12px; }
  footer { margin-top: auto; }
</style>
</head>
<body>
  <div class="top-bar">
    <a href="/">gitzette</a>
    <span class="sep">/</span>
    <span class="current">@${username}</span>
  </div>
  <div class="content">
    <div class="profile-header">
      ${avatar_url ? `<img src="${avatar_url}" class="avatar" alt="@${username}" loading="lazy">` : ""}
      <div>
        <div class="username">@${username}</div>
        <div class="github-link"><a href="https://github.com/${username}" target="_blank" rel="noopener">github.com/${username}</a></div>
      </div>
    </div>
    <div class="dispatch-count">${dispatches.length} dispatch${dispatches.length !== 1 ? "es" : ""}</div>
    <div>${rows}</div>
    ${dispatches.length > 0 ? `
    <div style="margin-top:32px;border-top:1px solid var(--rule);padding-top:20px;">
      <div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:12px;">▸ latest dispatch</div>
      <div style="position:relative;overflow:hidden;border:1px solid var(--rule);height:280px;background:var(--paper);cursor:pointer;" onclick="window.location='/${username}/${dispatches[0].week_key}'">
        <iframe src="/${username}/${dispatches[0].week_key}" style="width:200%;height:560px;transform:scale(0.5);transform-origin:top left;pointer-events:none;border:none;" loading="lazy" title="Latest dispatch"></iframe>
        <div style="position:absolute;inset:0;"></div>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:8px;">${weekKeyToRange(dispatches[0].week_key)} · <a href="/${username}/${dispatches[0].week_key}" style="color:var(--ink);">read full dispatch →</a></div>
    </div>` : ""}
  </div>
  <footer>
    ${ctaFooter()}
    ${creatorFooter()}
  </footer>
</body>
</html>`;
}

// ── routes ────────────────────────────────────────────────────────────────────

// home page
pageRoutes.get("/", async (c) => {
  const user = await getUser(c);

  // fetch recent dispatches for the landing page
  const recent = await c.env.DB.prepare(
    `SELECT u.username, d.week_key, d.generated_at
     FROM dispatches d
     JOIN users u ON u.id = d.user_id
     WHERE d.r2_key IS NOT NULL AND d.week_key != 'generating'
     ORDER BY d.generated_at DESC LIMIT 100`
  ).all<{ username: string; week_key: string; generated_at: number }>();

  return c.html(homePage(recent.results ?? []));
});

// /status — private quota dashboard (token-gated)
// serve illustration images from R2
pageRoutes.get("/img/:slug{[a-zA-Z0-9_-]+\\.jpg}", async (c) => {
  const { slug } = c.req.param();
  const obj = await c.env.DISPATCHES.get(`illustrations/${slug}`);
  if (!obj) return c.text("not found", 404);
  const buf = await obj.arrayBuffer();
  return new Response(buf, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});

pageRoutes.get("/status", async (c) => {
  const token = c.req.query("token");
  if (!token || token !== c.env.SESSION_SECRET) {
    return c.text("403 Forbidden", 403);
  }
  const [spendRow, genRow, userRow] = await Promise.all([
    c.env.DB.prepare(`SELECT COALESCE(SUM(cost_usd),0) as total FROM spend_log WHERE strftime('%Y-%m', datetime(ts, 'unixepoch')) = strftime('%Y-%m', 'now')`).first<{ total: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) as total FROM dispatches WHERE week_key != 'generating' AND r2_key IS NOT NULL`).first<{ total: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) as total FROM users`).first<{ total: number }>(),
  ]);
  const monthlyBudget = parseFloat(c.env.MONTHLY_LLM_BUDGET_USD ?? "50");
  const spent = spendRow?.total ?? 0;
  const pct = Math.min(100, Math.round((spent / monthlyBudget) * 100));
  return c.html(statusPage({ spent, monthlyBudget, pct, dispatches: genRow?.total ?? 0, users: userRow?.total ?? 0 }));
});

// public profile page — lists all dispatches (or latest if only one)
pageRoutes.get("/:username{[a-zA-Z0-9_-]+}", async (c) => {
  const { username } = c.req.param();
  const viewer = await getUser(c);
  const isOwner = viewer?.username === username;

  // Check if user exists + fetch avatar
  const userRow = await c.env.DB.prepare(
    `SELECT id, avatar_url FROM users WHERE username = ?`
  ).bind(username).first<{ id: number; avatar_url: string | null }>();

  if (!userRow) {
    // Check if this is a real GitHub user — if so, offer to generate
    let ghUser: { login: string; avatar_url: string; name: string | null } | null = null;
    try {
      const ghRes = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, {
        headers: { "User-Agent": "gitzette/1.0", "Accept": "application/vnd.github+json" },
      });
      if (ghRes.ok) ghUser = await ghRes.json() as any;
    } catch { /* ignore */ }
    return c.html(notFoundPage(username, ghUser), 404);
  }

  // Check if generating sentinel exists
  const generating = await c.env.DB.prepare(
    `SELECT 1 FROM dispatches WHERE user_id = ? AND week_key = 'generating'`
  ).bind(userRow.id).first();
  if (generating) return c.html(generatingPage(username));

  // Query ALL real dispatches
  const allDispatches = await c.env.DB.prepare(
    `SELECT d.week_key, d.r2_key, d.generated_at
     FROM dispatches d
     WHERE d.user_id = ? AND d.week_key != 'generating' AND d.r2_key IS NOT NULL
     ORDER BY d.week_key DESC`
  ).bind(userRow.id).all<{ week_key: string; r2_key: string; generated_at: number }>();

  const dispatches = allDispatches.results ?? [];

  if (dispatches.length === 0) {
    return c.html(noDispatchPage(username, isOwner, null));
  }

  // If exactly one dispatch, serve it directly (backwards compat)
  if (dispatches.length === 1) {
    const d = dispatches[0];
    return fetchAndServeDispatch(c, username, d.week_key, d.r2_key, d.generated_at, isOwner);
  }

  // Multiple dispatches: show profile listing page
  return c.html(userProfilePage(username, userRow.avatar_url, dispatches));
});

// specific week: /username/2026-W13
pageRoutes.get("/:username{[a-zA-Z0-9_-]+}/:week_key{\\d{4}-W\\d{1,2}}", async (c) => {
  const { username, week_key } = c.req.param();
  const viewer = await getUser(c);
  const isOwner = viewer?.username === username;

  const dispatchMeta = await c.env.DB.prepare(
    `SELECT d.r2_key, d.generated_at
     FROM dispatches d
     JOIN users u ON u.id = d.user_id
     WHERE u.username = ? AND d.week_key = ?`
  ).bind(username, week_key).first<{ r2_key: string | null; generated_at: number }>();

  if (!dispatchMeta?.r2_key) {
    return c.html(weekNotFoundPage(username, week_key), 404);
  }

  return fetchAndServeDispatch(c, username, week_key, dispatchMeta.r2_key, dispatchMeta.generated_at, isOwner);
});

// ── templates ─────────────────────────────────────────────────────────────────

function homePage(recent: { username: string; week_key: string; generated_at: number }[]): string {
  const rows = recent.map(d => {
    const short = d.week_key.replace(/^\d{4}-/, "");
    const range = weekKeyToRange(d.week_key);
    return `<a href="/${d.username}/${d.week_key}" class="dispatch-row">
      <span class="row-user">@${d.username}</span>
      <span class="row-date">${range}<span class="row-week-secondary">${short}</span></span>
      <span class="row-cta">Read →</span>
    </a>`;
  }).join("");

  const homeOG = `<meta property="og:title" content="gitzette — your open-source week as a newspaper">
<meta property="og:description" content="Turn your GitHub activity into a shareable weekly dispatch. No writing required.">
<meta property="og:url" content="https://gitzette.online/">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="gitzette — your open-source week as a newspaper">
<meta name="twitter:description" content="Turn your GitHub activity into a shareable weekly dispatch. No writing required.">`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>gitzette — your weekly open-source dispatch</title>
${homeOG}
${headTags()}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Serif:ital,wght@0,400;0,700;1,400&family=Playfair+Display:ital,wght@0,700;0,900;1,700;1,900&display=swap" rel="stylesheet">
<style>
  :root { --ink: #0f0f0f; --paper: #f7f4ee; --rule: #c8c2b4; --muted: #666; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'IBM Plex Serif', Georgia, serif; background: var(--paper); color: var(--ink); min-height: 100vh; display: flex; flex-direction: column; overflow-x: hidden; }
  a { color: var(--ink); text-decoration: none; }
  .hero { width: 100%; max-width: 760px; margin: 64px auto 0; padding: 0 20px; box-sizing: border-box; }
  @media (max-width: 640px) { .hero { margin-top: 28px; } }
  .masthead { font-family: 'Playfair Display', serif; font-weight: 900; font-style: italic; font-size: clamp(52px, 13vw, 100px); line-height: 1; }
  .tagline { font-size: clamp(15px, 2.5vw, 20px); color: var(--muted); margin: 16px 0 32px; font-style: italic; }
  .form-row { display: flex; gap: 0; max-width: 100%; }
  .form-row input { flex: 1; min-width: 0; padding: 12px 14px; border: 2px solid var(--ink); background: var(--paper); font-family: 'IBM Plex Mono', monospace; font-size: 15px; color: var(--ink); outline: none; }
  .form-row input::placeholder { color: var(--muted); }
  .form-row button { flex-shrink: 0; padding: 12px 20px; background: var(--ink); color: var(--paper); font-family: 'IBM Plex Mono', monospace; font-size: 14px; font-weight: 600; border: none; cursor: pointer; letter-spacing: .04em; white-space: nowrap; }
  .form-row button:hover { background: #333; }
  .divider { width: 100%; max-width: 760px; margin: 56px auto 0; padding: 0 20px; box-sizing: border-box; border-top: 3px double var(--ink); }
  .recent-head { font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; padding: 12px 0 16px; color: var(--muted); }
  .dispatch-list { width: 100%; max-width: 760px; margin: 0 auto; padding: 0 20px; box-sizing: border-box; }
  .dispatch-row { display: flex; align-items: baseline; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--rule); text-decoration: none; color: var(--ink); transition: background .1s; }
  .dispatch-row:hover { background: #edeae2; margin: 0 -8px; padding-left: 8px; padding-right: 8px; }
  .row-user { font-family: 'IBM Plex Mono', monospace; font-size: 13px; font-weight: 600; min-width: 120px; }
  .row-date { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--ink); flex: 1; display: flex; align-items: baseline; gap: 8px; }
  .row-week-secondary { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--muted); }
  .row-cta { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--muted); flex-shrink: 0; }
  .auth-note { width: 100%; max-width: 760px; margin: 0 auto; padding: 0 20px; box-sizing: border-box; font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--muted); }
  .auth-note a { color: var(--ink); text-decoration: none; }
  footer { margin-top: auto; }
</style>
</head>
<body>
  <div class="hero">
    <div class="masthead">gitzette</div>
    <div class="tagline">Show your work, without writing about it.</div>
    <div style="font-family:'IBM Plex Serif',serif;font-size:14px;font-style:italic;color:#888;margin:-20px 0 24px;">For open-source maintainers and builders. Your GitHub week, turned into a shareable newspaper — automatically.</div>
    <div style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:#888;margin-bottom:10px;">No account needed — explore anyone's open-source week</div>
    <form id="read-form" class="form-row" action="" method="get" onsubmit="go(event)">
      <input id="username-input" type="text" placeholder="try: torvalds, sindresorhus, antirez" autocomplete="off" autocorrect="off" spellcheck="false">
      <button type="submit">Read →</button>
    </form>
    <div style="margin-top:12px;margin-bottom:28px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#888;">explore:</span>
      <button onclick="document.getElementById('username-input').value='torvalds';go2('torvalds');" style="font-family:'IBM Plex Mono',monospace;font-size:11px;background:none;border:1px solid var(--ink);padding:3px 10px;cursor:pointer;">torvalds</button>
      <button onclick="document.getElementById('username-input').value='antirez';go2('antirez');" style="font-family:'IBM Plex Mono',monospace;font-size:11px;background:none;border:1px solid var(--ink);padding:3px 10px;cursor:pointer;">antirez</button>
      <button onclick="document.getElementById('username-input').value='sindresorhus';go2('sindresorhus');" style="font-family:'IBM Plex Mono',monospace;font-size:11px;background:none;border:1px solid var(--ink);padding:3px 10px;cursor:pointer;">sindresorhus</button>
      <button onclick="document.getElementById('username-input').value='gaearon';go2('gaearon');" style="font-family:'IBM Plex Mono',monospace;font-size:11px;background:none;border:1px solid var(--ink);padding:3px 10px;cursor:pointer;">gaearon</button>
      <button onclick="document.getElementById('username-input').value='Rich-Harris';go2('Rich-Harris');" style="font-family:'IBM Plex Mono',monospace;font-size:11px;background:none;border:1px solid var(--ink);padding:3px 10px;cursor:pointer;">Rich-Harris</button>
    </div>
    <script>
    function go(e) {
      e.preventDefault();
      const u = document.getElementById('username-input').value.trim().replace(/^@/,'');
      if (u) window.location.href = '/' + u;
    }
    function go2(u) {
      window.location.href = '/' + u;
    }
    </script>
    <div class="auth-note">
      <a href="/auth/github" style="display:inline-flex;align-items:center;gap:8px;margin-top:4px;padding:11px 20px;background:var(--ink);color:var(--paper);font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:700;letter-spacing:.04em;text-decoration:none;border:none;">
        ⬡ Generate my dispatch
      </a>
      <p style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#888;margin-top:10px;">Signs in with GitHub. We only read public activity — commits, PRs, releases. No private repo access, ever.</p>
    </div>
  </div>
  <div style="max-width:760px;margin:0 auto;padding:0 20px;box-sizing:border-box;">
    <div style="margin:40px 0;">
      <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#888;margin-bottom:12px;">▸ example dispatch</div>
      <div style="position:relative;overflow:hidden;border:1px solid #c8c2b4;height:320px;background:#f7f4ee;cursor:pointer;" onclick="window.location='/NikolayS/2026-W13'">
        <iframe src="/NikolayS/2026-W13" style="width:200%;height:640px;transform:scale(0.5);transform-origin:top left;pointer-events:none;border:none;" loading="lazy" title="Example dispatch"></iframe>
        <div style="position:absolute;inset:0;"></div>
      </div>
      <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#888;margin-top:8px;">@NikolayS · <a href="/NikolayS/2026-W13" style="color:var(--ink);">view full dispatch →</a></div>
    </div>
  </div>
  ${recent.length > 0 ? `
  <div class="divider">
    <div class="recent-head">Recent dispatches</div>
  </div>
  <div class="dispatch-list">${rows}</div>` : ""}
  <footer>
    ${ctaFooter()}
    ${creatorFooter()}
  </footer>
</body>
</html>`;
}

function statusPage(stats: { spent: number; monthlyBudget: number; pct: number; dispatches: number; users: number }): string {
  const barW = Math.max(2, stats.pct);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>gitzette — system status</title>
${headTags()}
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  :root { --ink: #0f0f0f; --paper: #f7f4ee; --rule: #c8c2b4; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'IBM Plex Mono',monospace; background:var(--paper); color:var(--ink); padding:40px 24px; }
  h1 { font-size:28px; font-weight:700; letter-spacing:-.02em; margin-bottom:4px; }
  .sub { font-size:12px; color:#888; margin-bottom:40px; }
  .stat { margin-bottom:32px; }
  .label { font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:#888; margin-bottom:6px; }
  .value { font-size:32px; font-weight:700; }
  .bar-track { height:6px; background:#e0ddd5; margin-top:8px; max-width:400px; }
  .bar-fill { height:6px; background:var(--ink); }
  .hint { font-size:11px; color:#888; margin-top:4px; }
  a { color:var(--ink); }
</style>
</head>
<body>
  <h1>gitzette status</h1>
  <div class="sub">live system metrics · <a href="/">← home</a></div>
  <div class="stat">
    <div class="label">LLM budget (this month)</div>
    <div class="value">$${stats.spent.toFixed(2)} / $${stats.monthlyBudget.toFixed(0)}</div>
    <div class="bar-track"><div class="bar-fill" style="width:${barW}%"></div></div>
    <div class="hint">${stats.pct}% used · resets 1st of month</div>
  </div>
  <div class="stat">
    <div class="label">Dispatches generated</div>
    <div class="value">${stats.dispatches}</div>
  </div>
  <div class="stat">
    <div class="label">Users</div>
    <div class="value">${stats.users}</div>
  </div>
  ${creatorFooter()}
</body>
</html>`;
}

function dispatchPage(
  username: string,
  dispatch: { html: string; week_key: string; generated_at: number },
  isOwner: boolean
): string {
  const generatedDate = new Date(dispatch.generated_at * 1000).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>@${username} — gitzette ${dispatch.week_key}</title>
${headTags()}
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Serif:ital,wght@0,400;0,700;1,400&family=Playfair+Display:ital,wght@0,700;0,900;1,700;1,900&display=swap" rel="stylesheet">
<style>
  :root { --ink: #0f0f0f; --paper: #f7f4ee; --rule: #c8c2b4; --muted: #666; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #e8e4dc; font-family: 'IBM Plex Serif', Georgia, serif; color: var(--ink); }
  a { color: var(--ink); }
  .paper { max-width: 900px; margin: 24px auto; background: var(--paper); border: 1px solid var(--rule); padding: 32px; box-shadow: 0 2px 12px rgba(0,0,0,.12); overflow-x: hidden; }
  @media (max-width: 640px) { .paper { margin: 0; padding: 16px; border-left: none; border-right: none; } }
  .header { border-bottom: 3px solid var(--ink); padding-bottom: 12px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: baseline; }
  .masthead { font-family: 'IBM Plex Mono', monospace; font-size: 32px; font-weight: 700; letter-spacing: -.03em; }
  .meta { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--muted); text-align: right; }
  .content { line-height: 1.7; }
  .content img { max-width: 100%; height: auto; display: block; }
  .top-bar { background: #0f0f0f; padding: 8px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .breadcrumb { font-family: 'IBM Plex Mono', monospace; font-size: 12px; display: flex; align-items: center; gap: 6px; color: #888; }
  .breadcrumb a { color: #aaa; text-decoration: none; border: none; }
  .breadcrumb a:hover { color: #f7f4ee; }
  .breadcrumb .sep { color: #555; }
  .breadcrumb .current { color: #f7f4ee; }
  .breadcrumb-logo { font-family: 'Playfair Display', serif; font-weight: 900; font-style: italic; font-size: 22px; color: #f7f4ee; line-height: 1; }
  .regen-btn { background: none; border: 1px solid #555; color: #aaa; font-family: 'IBM Plex Mono', monospace; font-size: 12px; padding: 4px 12px; cursor: pointer; }
  .regen-btn:hover { border-color: #f7f4ee; color: #f7f4ee; }
</style>
</head>
<body>
  <div class="top-bar">
    <div class="breadcrumb">
      <a href="/" class="breadcrumb-logo">gitzette</a>
      <span class="sep">/</span>
      <a href="/${username}">@${username}</a>
      <span class="sep">/</span>
      <span class="current">${weekKeyToRange(dispatch.week_key)}</span>
      <span style="font-size:10px;color:#666;">${dispatch.week_key.replace(/^\d{4}-/, "")}</span>
    </div>
    <div style="display:flex;gap:12px;align-items:center;">
      ${weekNavBar(username, dispatch.week_key)}
      ${isOwner ? `<button class="regen-btn" onclick="regenerate()">regenerate</button>` : ""}
    </div>
  </div>
  <div class="paper">
    <div class="content">${dispatch.html}</div>
  </div>
  ${dispatchFooter(username, dispatch.week_key)}
  ${isOwner ? `<script>
  var _regenPending=false,_regenTimer=null;
  async function regenerate() {
    const btn = document.querySelector('.regen-btn');
    if (!_regenPending) {
      _regenPending=true;
      btn.textContent='Sure? Click again to confirm';
      _regenTimer=setTimeout(()=>{_regenPending=false;btn.textContent='regenerate';},5000);
      return;
    }
    clearTimeout(_regenTimer);_regenPending=false;
    btn.disabled=true; btn.textContent='generating...';
    const res = await fetch('/generate',{method:'POST'});
    const data = await res.json();
    if (data.error) { btn.textContent=data.message||data.error; setTimeout(()=>{btn.disabled=false;btn.textContent='regenerate';},5000); return; }
    let n=0;
    const poll=setInterval(async()=>{
      n++;
      const s=await fetch('/generate/status').then(r=>r.json());
      if(s.status==='ready'&&s.week_key!=='generating'){clearInterval(poll);location.reload();}
      else if(n>24){clearInterval(poll);btn.textContent='reload manually';}
      else btn.textContent='generating... ('+(n*5)+'s)';
    },5000);
  }
  </script>` : ""}
</body>
</html>`;
}

function noDispatchPage(username: string, isOwner: boolean, week_key: string | null): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>@${username} — gitzette</title>
${headTags()}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=Playfair+Display:ital,wght@0,700;0,900;1,700;1,900&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'IBM Plex Mono',monospace;background:#f7f4ee;min-height:100vh;display:flex;flex-direction:column;}
  .center{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;padding:40px 24px;text-align:center;}
</style>
</head><body>
  <div class="center">
    <a href="/" style="font-family:'Playfair Display',serif;font-weight:900;font-style:italic;font-size:clamp(36px,10vw,60px);color:#0f0f0f;text-decoration:none;line-height:1;">gitzette</a>
    <div style="font-size:18px;font-weight:700;">@${username}</div>
    <div style="color:#666;">No dispatch generated yet${week_key ? ` for ${week_key}` : ""}.</div>
    ${isOwner ? `<button id="genbtn" onclick="startGen()" style="padding:10px 24px;background:#0f0f0f;color:#f7f4ee;border:none;font-family:monospace;cursor:pointer;">generate now</button>
    <script>
    async function startGen(){const btn=document.getElementById('genbtn');btn.disabled=true;btn.textContent='generating...';await fetch('/generate',{method:'POST'});let n=0;const iv=setInterval(async()=>{n++;btn.textContent='generating... ('+n*5+'s)';const s=await fetch('/generate/status').then(r=>r.json());if(s.status==='ready'&&s.week_key!=='generating'){clearInterval(iv);location.reload();}if(n>24){clearInterval(iv);btn.textContent='reload manually';}},5000);}
    </script>` : ""}
    <a href="/" style="color:#888;font-size:12px;">← gitzette.online</a>
  </div>
  ${ctaFooter()}
  ${creatorFooter()}
</body></html>`;
}

function weekNotFoundPage(username: string, week_key: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>@${username} ${week_key} — gitzette</title>
${headTags()}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=Playfair+Display:ital,wght@0,700;0,900;1,700;1,900&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'IBM Plex Mono',monospace;background:#f7f4ee;min-height:100vh;display:flex;flex-direction:column;}
  .center{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;padding:40px 24px;text-align:center;}
</style>
</head><body>
  <div class="center">
    <a href="/" style="font-family:'Playfair Display',serif;font-weight:900;font-style:italic;font-size:clamp(36px,10vw,60px);color:#0f0f0f;text-decoration:none;line-height:1;">gitzette</a>
    <div style="font-size:18px;font-weight:700;">@${username} · ${week_key}</div>
    <div style="color:#666;">No dispatch for this week.</div>
    <a href="/${username}" style="color:#0f0f0f;font-size:13px;font-family:monospace;">← view latest dispatch</a>
  </div>
  ${ctaFooter()}
  ${creatorFooter()}
</body></html>`;
}

function generatingPage(username: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>@${username} — gitzette</title>
${headTags()}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=Playfair+Display:ital,wght@0,700;0,900;1,700;1,900&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'IBM Plex Mono',monospace;background:#f7f4ee;min-height:100vh;display:flex;flex-direction:column;}
  .center{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;padding:40px 24px;text-align:center;}
</style>
</head><body>
  <div class="center">
    <a href="/" style="font-family:'Playfair Display',serif;font-weight:900;font-style:italic;font-size:clamp(36px,10vw,60px);color:#0f0f0f;text-decoration:none;line-height:1;">gitzette</a>
    <div style="font-size:18px;font-weight:700;">@${username}</div>
    <div id="status-msg" style="color:#666;">Generating dispatch... this takes about 60 seconds.</div>
    <div id="retry-btn" style="display:none;">
      <div style="color:#c00;font-size:13px;margin-bottom:12px;">Generation timed out. Something went wrong.</div>
      <a href="/generate" id="retry-link" style="display:inline-block;padding:10px 24px;background:#0f0f0f;color:#f7f4ee;font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:700;text-decoration:none;" onclick="this.textContent='retrying...';retryGen();return false;">Try again</a>
    </div>
    <a href="/" style="color:#888;font-size:12px;">← gitzette.online</a>
  </div>
  ${ctaFooter()}
  ${creatorFooter()}
  <script>
  let n = 0;
  const iv = setInterval(async () => {
    n++;
    try {
      const s = await fetch('/generate/status').then(r => r.json());
      if (s.status === 'ready') { clearInterval(iv); location.reload(); return; }
      if (s.status === 'failed') {
        clearInterval(iv);
        document.getElementById('status-msg').style.display = 'none';
        document.getElementById('retry-btn').style.display = 'block';
        return;
      }
      if (s.status === 'generating') {
        document.getElementById('status-msg').textContent = 'Generating dispatch... (' + Math.round(s.age) + 's)';
      }
    } catch(e) {}
    if (n > 36) { // 3 min client-side max
      clearInterval(iv);
      document.getElementById('status-msg').style.display = 'none';
      document.getElementById('retry-btn').style.display = 'block';
    }
  }, 5000);

  async function retryGen() {
    await fetch('/generate', { method: 'POST' });
    setTimeout(() => location.reload(), 2000);
  }
  </script>
</body></html>`;
}

function notFoundPage(username: string, ghUser?: { login: string; avatar_url: string; name: string | null } | null): string {
  const isRealGitHubUser = !!ghUser;
  const displayName = ghUser?.name || `@${username}`;

  const content = isRealGitHubUser ? `
    <img src="${ghUser!.avatar_url}" alt="@${username}" style="width:72px;height:72px;border-radius:50%;border:2px solid #0f0f0f;margin-bottom:4px;">
    <div style="font-size:18px;font-weight:700;">${displayName}</div>
    <div style="font-size:13px;color:#666;margin-bottom:8px;">@${username}</div>
    <div style="color:#444;max-width:280px;line-height:1.5;">No dispatch generated yet for <strong>@${username}</strong>.</div>
    <div style="color:#666;font-size:12px;max-width:280px;line-height:1.5;">Is this your account? Sign in with GitHub to generate your first dispatch.</div>
    <a href="/auth/github" style="display:inline-block;margin-top:8px;padding:12px 28px;background:#0f0f0f;color:#f7f4ee;font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:700;text-decoration:none;border-radius:2px;letter-spacing:0.05em;">Generate my dispatch</a>
    <a href="/" style="color:#888;font-size:12px;margin-top:8px;">← gitzette.online</a>
  ` : `
    <div style="font-size:18px;font-weight:700;">@${username}</div>
    <div style="color:#666;">GitHub user not found.</div>
    <a href="/" style="color:#888;font-size:12px;">← gitzette.online</a>
  `;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>@${username} — gitzette</title>
${headTags()}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=Playfair+Display:ital,wght@0,700;0,900;1,700;1,900&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'IBM Plex Mono',monospace;background:#f7f4ee;min-height:100vh;display:flex;flex-direction:column;}
  .center{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:40px 24px;text-align:center;}
</style>
</head><body>
  <div class="center">
    <a href="/" style="font-family:'Playfair Display',serif;font-weight:900;font-style:italic;font-size:clamp(36px,10vw,60px);color:#0f0f0f;text-decoration:none;line-height:1;margin-bottom:8px;">gitzette</a>
    ${content}
  </div>
  ${ctaFooter()}
  ${creatorFooter()}
</body></html>`;
}
