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
  return `<span style="font-family:monospace;font-size:11px;letter-spacing:.04em;display:flex;align-items:center;gap:8px;">
    <a href="/${username}/${prev}" style="color:var(--ink,#0f0f0f);border:none;text-decoration:none;">← ${short(prev)}</a>
    <span style="color:var(--rule,#c8c2b4);">|</span>
    <span style="font-weight:600;">${short(week_key)}</span>
    <span style="color:var(--rule,#c8c2b4);">|</span>
    ${isFuture
      ? `<span style="color:#bbb;">${short(next)} →</span>`
      : `<a href="/${username}/${next}" style="color:var(--ink,#0f0f0f);border:none;text-decoration:none;">${short(next)} →</a>`
    }
  </span>`;
}

function creatorFooter(): string {
  return `<div style="background:#0f0f0f;padding:10px 24px;text-align:center;font-family:monospace;font-size:11px;color:#666;">
    built by <a href="https://github.com/NikolayS" style="color:#aaa;text-decoration:none;border:none;">@NikolayS</a>
    &nbsp;·&nbsp;
    <a href="https://gitzette.online" style="color:#aaa;text-decoration:none;border:none;">gitzette.online</a>
  </div>`;
}

function ctaFooter(): string {
  return `<div style="background:#0f0f0f;padding:14px 24px;text-align:center;font-family:monospace;font-size:13px;">
    <span style="color:#888;">Your open-source activity, turned into a weekly dispatch.</span>
    &nbsp;&nbsp;
    <a href="https://gitzette.online" style="color:#f7f4ee;text-decoration:none;border-bottom:1px solid #555;">Generate yours at gitzette.online →</a>
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

  // inject image overflow fix for all dispatch HTML documents
  const IMG_FIX = `<style>img{max-width:100%!important;height:auto!important;display:block;}</style>`;

  if (html.startsWith("<!DOCTYPE") || html.startsWith("<html")) {
    const ownerBar = isOwner
      ? `<div style="position:fixed;top:0;left:0;right:0;z-index:999;background:#0f0f0f;padding:8px 16px;display:flex;align-items:center;justify-content:space-between;font-family:monospace;font-size:12px;gap:12px;flex-wrap:wrap;">
          <span style="color:#f7f4ee;">@${username} · ${week_key} · generated ${new Date(generated_at * 1000).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span>
          <div style="display:flex;gap:12px;align-items:center;">
            ${weekNavBar(username, week_key)}
            <button style="background:none;border:1px solid #f7f4ee;color:#f7f4ee;font-family:monospace;font-size:12px;padding:3px 10px;cursor:pointer;" onclick="regenerate()">regenerate</button>
          </div>
        </div>
        <div style="height:40px;"></div>
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
      : `<div style="position:fixed;top:0;left:0;right:0;z-index:999;background:#0f0f0f;padding:8px 16px;display:flex;align-items:center;justify-content:space-between;font-family:monospace;font-size:12px;">
          <span style="color:#f7f4ee;">@${username}</span>
          ${weekNavBar(username, week_key)}
        </div>
        <div style="height:36px;"></div>`;

    const out = html
      .replace("</head>", `${IMG_FIX}</head>`)
      .replace("<body>", `<body>${ownerBar}`)
      .replace("</body>", `${ctaFooter()}${creatorFooter()}</body>`);
    return c.html(out);
  }

  return c.html(dispatchPage(username, { html, week_key, generated_at }, isOwner));
}

// ── routes ────────────────────────────────────────────────────────────────────

// home page
pageRoutes.get("/", async (c) => {
  const user = await getUser(c);
  if (user) return c.redirect(`/${user.username}`);

  // fetch recent dispatches for the landing page
  const recent = await c.env.DB.prepare(
    `SELECT u.username, d.week_key, d.generated_at
     FROM dispatches d
     JOIN users u ON u.id = d.user_id
     WHERE d.r2_key IS NOT NULL AND d.week_key != 'generating'
     ORDER BY d.generated_at DESC LIMIT 12`
  ).all<{ username: string; week_key: string; generated_at: number }>();

  return c.html(homePage(recent.results ?? []));
});

// /status — private quota dashboard (token-gated)
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
  const cards = recent.map(d => {
    const short = d.week_key.replace(/^\d{4}-/, "");
    const date = new Date(d.generated_at * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `<a href="/${d.username}" class="card">
      <span class="card-user">@${d.username}</span>
      <span class="card-week">${short} · ${date}</span>
      <span class="card-cta">Read →</span>
    </a>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>gitzette — your weekly open-source dispatch</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Serif:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
<style>
  :root { --ink: #0f0f0f; --paper: #f7f4ee; --rule: #c8c2b4; --muted: #666; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'IBM Plex Serif', Georgia, serif; background: var(--paper); color: var(--ink); min-height: 100vh; display: flex; flex-direction: column; }
  a { color: var(--ink); text-decoration: none; }
  .hero { max-width: 760px; margin: 80px auto 0; padding: 0 24px; }
  .masthead { font-family: 'IBM Plex Mono', monospace; font-size: clamp(48px, 10vw, 88px); font-weight: 700; letter-spacing: -.04em; line-height: 1; }
  .tagline { font-size: clamp(16px, 2.5vw, 20px); color: var(--muted); margin: 16px 0 40px; font-style: italic; }
  .form-row { display: flex; gap: 0; max-width: 480px; }
  .form-row input { flex: 1; padding: 12px 16px; border: 2px solid var(--ink); background: var(--paper); font-family: 'IBM Plex Mono', monospace; font-size: 15px; color: var(--ink); outline: none; }
  .form-row input::placeholder { color: var(--muted); }
  .form-row button { padding: 12px 24px; background: var(--ink); color: var(--paper); font-family: 'IBM Plex Mono', monospace; font-size: 14px; font-weight: 600; border: none; cursor: pointer; letter-spacing: .04em; }
  .form-row button:hover { background: #333; }
  .divider { max-width: 760px; margin: 64px auto 0; padding: 0 24px; border-top: 3px double var(--ink); }
  .recent-head { font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; padding: 12px 0 20px; color: var(--muted); }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1px; background: var(--rule); max-width: 760px; margin: 0 auto; padding: 0 24px; }
  .card { display: flex; flex-direction: column; gap: 4px; padding: 16px; background: var(--paper); transition: background .1s; }
  .card:hover { background: #edeae2; }
  .card-user { font-family: 'IBM Plex Mono', monospace; font-size: 13px; font-weight: 600; }
  .card-week { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--muted); }
  .card-cta { font-family: 'IBM Plex Mono', monospace; font-size: 11px; margin-top: 4px; }
  .auth-note { max-width: 760px; margin: 32px auto 0; padding: 0 24px; font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--muted); }
  .auth-note a { color: var(--ink); border-bottom: 1px solid var(--rule); }
  footer { margin-top: auto; }
</style>
</head>
<body>
  <div class="hero">
    <div class="masthead">gitzette</div>
    <div class="tagline">Your open-source activity, turned into a weekly newspaper.</div>
    <form class="form-row" action="" method="get" onsubmit="go(event)">
      <input id="uname" type="text" placeholder="github username" autocomplete="off" autocorrect="off" spellcheck="false">
      <button type="submit">Read →</button>
    </form>
    <script>
    function go(e) {
      e.preventDefault();
      const u = document.getElementById('uname').value.trim().replace(/^@/,'');
      if (u) window.location.href = '/' + u;
    }
    </script>
    <div class="auth-note">To generate your own dispatch, <a href="/auth/github">sign in with GitHub</a>.</div>
  </div>
  ${recent.length > 0 ? `
  <div class="divider">
    <div class="recent-head">Recent dispatches</div>
  </div>
  <div class="cards">${cards}</div>` : ""}
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
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Serif:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
<style>
  :root { --ink: #0f0f0f; --paper: #f7f4ee; --rule: #c8c2b4; --muted: #666; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #e8e4dc; font-family: 'IBM Plex Serif', Georgia, serif; color: var(--ink); }
  a { color: var(--ink); }
  .paper { max-width: 900px; margin: 24px auto; background: var(--paper); border: 1px solid var(--rule); padding: 32px; box-shadow: 0 2px 12px rgba(0,0,0,.12); }
  .header { border-bottom: 3px solid var(--ink); padding-bottom: 12px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: baseline; }
  .masthead { font-family: 'IBM Plex Mono', monospace; font-size: 32px; font-weight: 700; letter-spacing: -.03em; }
  .meta { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--muted); text-align: right; }
  .content { line-height: 1.7; }
  .content img { max-width: 100%; height: auto; display: block; }
  .regen-bar { background: #0f0f0f; padding: 10px 16px; display: flex; align-items: center; justify-content: space-between; max-width: 900px; margin: 0 auto; gap: 12px; flex-wrap: wrap; }
  .regen-bar span { color: #f7f4ee; font-family: 'IBM Plex Mono', monospace; font-size: 12px; }
  .regen-btn { background: none; border: 1px solid #f7f4ee; color: #f7f4ee; font-family: 'IBM Plex Mono', monospace; font-size: 12px; padding: 4px 12px; cursor: pointer; }
</style>
</head>
<body>
  ${isOwner ? `
  <div class="regen-bar">
    <span>@${username} · ${dispatch.week_key} · generated ${generatedDate}</span>
    <div style="display:flex;gap:12px;align-items:center;">
      ${weekNavBar(username, dispatch.week_key)}
      <button class="regen-btn" onclick="regenerate()">regenerate</button>
    </div>
  </div>` : `
  <div style="background:#0f0f0f;padding:8px 16px;display:flex;align-items:center;justify-content:space-between;max-width:900px;margin:0 auto;font-family:monospace;font-size:12px;">
    <a href="/${username}" style="color:#f7f4ee;border:none;">@${username}</a>
    ${weekNavBar(username, dispatch.week_key)}
  </div>`}
  <div class="paper">
    <div class="header">
      <div class="masthead"><a href="/" style="border:none;color:var(--ink);">gitzette</a></div>
      <div class="meta">@${username}<br>${dispatch.week_key}</div>
    </div>
    <div class="content">${dispatch.html}</div>
  </div>
  ${ctaFooter()}
  ${creatorFooter()}
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
<html lang="en"><head><meta charset="UTF-8"><title>@${username} — gitzette</title>
<style>body{font-family:monospace;background:#f7f4ee;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px;}</style>
</head><body>
  <div style="font-size:32px;font-weight:700;">@${username}</div>
  <div style="color:#666;">No dispatch generated yet${week_key ? ` for ${week_key}` : ""}.</div>
  ${isOwner ? `<button id="genbtn" onclick="startGen()" style="padding:10px 24px;background:#0f0f0f;color:#f7f4ee;border:none;font-family:monospace;cursor:pointer;">generate now</button>
  <script>
  async function startGen(){const btn=document.getElementById('genbtn');btn.disabled=true;btn.textContent='generating...';await fetch('/generate',{method:'POST'});let n=0;const iv=setInterval(async()=>{n++;btn.textContent='generating... ('+n*5+'s)';const s=await fetch('/generate/status').then(r=>r.json());if(s.status==='ready'&&s.week_key!=='generating'){clearInterval(iv);location.reload();}if(n>24){clearInterval(iv);btn.textContent='reload manually';}},5000);}
  </script>` : ""}
  <a href="/" style="color:#888;font-size:12px;">← gitzette.online</a>
  ${creatorFooter()}
</body></html>`;
}

function weekNotFoundPage(username: string, week_key: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>@${username} ${week_key} — gitzette</title>
<style>body{font-family:monospace;background:#f7f4ee;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px;}</style>
</head><body>
  <div style="font-size:24px;font-weight:700;">@${username} · ${week_key}</div>
  <div style="color:#666;">No dispatch for this week.</div>
  <a href="/${username}" style="color:#0f0f0f;font-size:13px;font-family:monospace;">← view latest dispatch</a>
  ${creatorFooter()}
</body></html>`;
}

function generatingPage(username: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>@${username} — gitzette</title>
<meta http-equiv="refresh" content="10">
<style>body{font-family:monospace;background:#f7f4ee;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px;}</style>
</head><body>
  <div style="font-size:32px;font-weight:700;">@${username}</div>
  <div style="color:#666;">Generating dispatch... refreshing automatically.</div>
  <a href="/" style="color:#888;font-size:12px;">← gitzette.online</a>
  ${creatorFooter()}
</body></html>`;
}

function notFoundPage(username: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>not found — gitzette</title>
<style>body{font-family:monospace;background:#f7f4ee;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px;}</style>
</head><body>
  <div style="font-size:32px;font-weight:700;">@${username}</div>
  <div style="color:#666;">User not found. Have they signed in?</div>
  <a href="/" style="color:#888;font-size:12px;">← gitzette.online</a>
  ${creatorFooter()}
</body></html>`;
}
