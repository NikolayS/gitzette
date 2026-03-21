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

function weekNavBar(username: string, week_key: string): string {
  const prev = adjacentWeekKey(week_key, -1);
  const next = adjacentWeekKey(week_key, 1);
  const isFuture = next >= currentWeekKey();
  const short = (wk: string) => wk.replace(/^\d{4}-/, ""); // "W13"
  return `<span style="font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.04em;display:flex;align-items:center;gap:8px;white-space:nowrap;">
    <a href="/${username}/${prev}" style="color:#f7f4ee;border:none;text-decoration:none;opacity:.75;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='.75'">← ${short(prev)}</a>
    <span style="color:#444;">|</span>
    <span style="font-weight:600;color:#f7f4ee;">${short(week_key)}</span>
    <span style="color:#444;">|</span>
    ${isFuture
      ? `<span style="color:#444;">${short(next)} →</span>`
      : `<a href="/${username}/${next}" style="color:#f7f4ee;border:none;text-decoration:none;opacity:.75;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='.75'">${short(next)} →</a>`
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

function dispatchFooter(username: string, week_key: string): string {
  const url = `https://gitzette.online/${username}/${week_key}`;
  const tweetText = encodeURIComponent(`This week in open source: @${username}'s dispatch — ${url}`);
  const xUrl = `https://twitter.com/intent/tweet?text=${tweetText}`;
  const liUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
  return `
  <div style="background:#f7f4ee;border-top:1px solid #c8c2b4;">
    <!-- Row 1: Navigation links — left-aligned, ink, underlined -->
    <div style="max-width:900px;margin:0 auto;padding:14px 24px 6px;font-family:'IBM Plex Mono',monospace;font-size:12px;display:flex;flex-wrap:wrap;gap:4px 20px;align-items:center;">
      <a href="/" style="color:#0f0f0f;text-decoration:underline;">gitzette</a>
      <a href="/${username}" style="color:#0f0f0f;text-decoration:underline;">@${username} on gitzette</a>
      <a href="https://github.com/${username}" target="_blank" rel="noopener" style="color:#0f0f0f;text-decoration:underline;">@${username} on GitHub</a>
    </div>
    <!-- Row 2: Share links — muted, right-aligned -->
    <div style="max-width:900px;margin:0 auto;padding:6px 24px 14px;font-family:'IBM Plex Mono',monospace;font-size:12px;display:flex;flex-wrap:wrap;gap:4px 20px;align-items:center;justify-content:flex-end;color:#888;">
      <span>share:</span>
      <a href="${xUrl}" target="_blank" rel="noopener" style="color:#888;text-decoration:none;">post on X</a>
      <a href="${liUrl}" target="_blank" rel="noopener" style="color:#888;text-decoration:none;">share on LinkedIn</a>
    </div>
  </div>
  ${ctaFooter()}
  ${creatorFooter()}`;
}

function ctaFooter(): string {
  // Solid CTA block — dark background so the white/paper button pops.
  // Uses width:min(100%,420px) for full-width on mobile without a media query.
  return `<div style="background:#0f0f0f;padding:40px 24px 44px;text-align:center;font-family:'IBM Plex Mono',monospace;">
    <p style="color:#666;font-size:12px;letter-spacing:.04em;margin:0 0 20px;">Your open-source activity, turned into a weekly newspaper.</p>
    <a href="/auth/github"
       style="display:inline-block;background:#f7f4ee;color:#0f0f0f;font-family:'IBM Plex Mono',monospace;font-size:15px;font-weight:700;letter-spacing:.02em;text-decoration:none;padding:16px 40px;border:none;cursor:pointer;width:min(100%,420px);box-sizing:border-box;"
       onmouseover="this.style.background='#ffffff'"
       onmouseout="this.style.background='#f7f4ee'">Generate your dispatch &rarr;</a>
  </div>`;
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

  // Image overflow guard — injected into every served dispatch document
  const IMG_FIX_STYLE = `${headTags()}<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=UnifrakturMaguntia&display=swap" rel="stylesheet"><style>body img{max-width:100%!important;height:auto!important;}table{max-width:100%!important;width:100%!important;}td,th{word-break:break-word;}</style>`;

  if (html.startsWith("<!DOCTYPE") || html.startsWith("<html")) {
    const breadcrumb = `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;overflow:hidden;">
          <a href="/" style="font-family:'UnifrakturMaguntia',serif;font-size:22px;color:#f7f4ee;text-decoration:none;line-height:1;border:none;">gitzette</a>
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
            ${weekNavBar(username, week_key)}
            <button style="background:none;border:1px solid #555;color:#aaa;font-family:'IBM Plex Mono',monospace;font-size:12px;padding:3px 10px;cursor:pointer;" onmouseover="this.style.borderColor='#f7f4ee';this.style.color='#f7f4ee'" onmouseout="this.style.borderColor='#555';this.style.color='#aaa'" onclick="regenerate()">regenerate</button>
          </div>
        </div>
        <div style="min-height:48px;"></div>
        <script>
        async function regenerate() {
          const btn = document.querySelector('button');
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
            ${weekNavBar(username, week_key)}
          </div>
        </div>
        <div style="min-height:40px;"></div>`;

    const out = html
      .replace("</head>", `${IMG_FIX_STYLE}</head>`)
      .replace("<body>", `<body>${ownerBar}`)
      .replace("</body>", `${dispatchFooter(username, week_key)}</body>`);
    return c.html(out);
  }

  return c.html(dispatchPage(username, { html, week_key, generated_at }, isOwner));
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

// public dispatch page — latest week
pageRoutes.get("/:username{[a-zA-Z0-9_-]+}", async (c) => {
  const { username } = c.req.param();
  const viewer = await getUser(c);
  const isOwner = viewer?.username === username;

  const dispatchMeta = await c.env.DB.prepare(
    `SELECT d.r2_key, d.week_key, d.generated_at
     FROM dispatches d
     JOIN users u ON u.id = d.user_id
     WHERE u.username = ?
     ORDER BY d.generated_at DESC LIMIT 1`
  ).bind(username).first<{ r2_key: string | null; week_key: string; generated_at: number }>();

  if (!dispatchMeta || !dispatchMeta.r2_key) {
    const userExists = await c.env.DB.prepare(`SELECT 1 FROM users WHERE username = ?`).bind(username).first();
    if (!userExists) return c.html(notFoundPage(username), 404);
    if (dispatchMeta?.week_key === "generating") return c.html(generatingPage(username));
    return c.html(noDispatchPage(username, isOwner, null));
  }

  return fetchAndServeDispatch(c, username, dispatchMeta.week_key, dispatchMeta.r2_key, dispatchMeta.generated_at, isOwner);
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

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>gitzette — your weekly open-source dispatch</title>
${headTags()}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Serif:ital,wght@0,400;0,700;1,400&family=UnifrakturMaguntia&display=swap" rel="stylesheet">
<style>
  :root { --ink: #0f0f0f; --paper: #f7f4ee; --rule: #c8c2b4; --muted: #666; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'IBM Plex Serif', Georgia, serif; background: var(--paper); color: var(--ink); min-height: 100vh; display: flex; flex-direction: column; overflow-x: hidden; }
  a { color: var(--ink); text-decoration: none; }
  .hero { width: 100%; max-width: 760px; margin: 64px auto 0; padding: 0 20px; box-sizing: border-box; }
  .masthead { font-family: 'UnifrakturMaguntia', serif; font-size: clamp(52px, 13vw, 100px); line-height: 1; }
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
  .auth-note { width: 100%; max-width: 760px; margin: 28px auto 0; padding: 0 20px; box-sizing: border-box; font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--muted); }
  .auth-note a { color: var(--ink); border-bottom: 1px solid var(--rule); }
  footer { margin-top: auto; }
</style>
</head>
<body>
  <div class="hero">
    <div class="masthead">gitzette</div>
    <div class="tagline">Your open-source activity, turned into a weekly newspaper.</div>
    <div style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:#888;margin-bottom:10px;">No account needed — explore anyone's open-source week</div>
    <form id="read-form" class="form-row" action="" method="get" onsubmit="go(event)">
      <input id="username-input" type="text" placeholder="try: torvalds, sindresorhus, antirez" autocomplete="off" autocorrect="off" spellcheck="false">
      <button type="submit">Read →</button>
    </form>
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
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
    <div class="auth-note">To generate your own dispatch, <a href="/auth/github">sign in with GitHub</a>.
      <p style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#888;margin-top:6px;">We only read public activity — commits, PRs, releases. No private repo access, ever.</p>
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
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Serif:ital,wght@0,400;0,700;1,400&family=UnifrakturMaguntia&display=swap" rel="stylesheet">
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
  .breadcrumb-logo { font-family: 'UnifrakturMaguntia', serif; font-size: 22px; color: #f7f4ee; line-height: 1; }
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
  async function regenerate() {
    const btn = document.querySelector('.regen-btn');
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
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=UnifrakturMaguntia&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'IBM Plex Mono',monospace;background:#f7f4ee;min-height:100vh;display:flex;flex-direction:column;}
  .center{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;padding:40px 24px;text-align:center;}
</style>
</head><body>
  <div class="center">
    <a href="/" style="font-family:'UnifrakturMaguntia',serif;font-size:clamp(36px,10vw,60px);color:#0f0f0f;text-decoration:none;line-height:1;">gitzette</a>
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
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=UnifrakturMaguntia&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'IBM Plex Mono',monospace;background:#f7f4ee;min-height:100vh;display:flex;flex-direction:column;}
  .center{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;padding:40px 24px;text-align:center;}
</style>
</head><body>
  <div class="center">
    <a href="/" style="font-family:'UnifrakturMaguntia',serif;font-size:clamp(36px,10vw,60px);color:#0f0f0f;text-decoration:none;line-height:1;">gitzette</a>
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
<meta http-equiv="refresh" content="10">
${headTags()}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=UnifrakturMaguntia&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'IBM Plex Mono',monospace;background:#f7f4ee;min-height:100vh;display:flex;flex-direction:column;}
  .center{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;padding:40px 24px;text-align:center;}
</style>
</head><body>
  <div class="center">
    <a href="/" style="font-family:'UnifrakturMaguntia',serif;font-size:clamp(36px,10vw,60px);color:#0f0f0f;text-decoration:none;line-height:1;">gitzette</a>
    <div style="font-size:18px;font-weight:700;">@${username}</div>
    <div style="color:#666;">Generating dispatch... refreshing automatically.</div>
    <a href="/" style="color:#888;font-size:12px;">← gitzette.online</a>
  </div>
  ${ctaFooter()}
  ${creatorFooter()}
</body></html>`;
}

function notFoundPage(username: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>not found — gitzette</title>
${headTags()}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=UnifrakturMaguntia&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'IBM Plex Mono',monospace;background:#f7f4ee;min-height:100vh;display:flex;flex-direction:column;}
  .center{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;padding:40px 24px;text-align:center;}
</style>
</head><body>
  <div class="center">
    <a href="/" style="font-family:'UnifrakturMaguntia',serif;font-size:clamp(36px,10vw,60px);color:#0f0f0f;text-decoration:none;line-height:1;">gitzette</a>
    <div style="font-size:18px;font-weight:700;">@${username}</div>
    <div style="color:#666;">User not found. Have they signed in?</div>
    <a href="/" style="color:#888;font-size:12px;">← gitzette.online</a>
  </div>
  ${ctaFooter()}
  ${creatorFooter()}
</body></html>`;
}
