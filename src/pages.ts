import { Hono } from "hono";
import { getUser } from "./auth";
import type { Env } from "./index";

export const pageRoutes = new Hono<{ Bindings: Env }>();

// home page
pageRoutes.get("/", async (c) => {
  const user = await getUser(c);
  return c.html(homePage(user));
});

// public dispatch page for any user — gitzette.online/username
pageRoutes.get("/:username{[a-zA-Z0-9_-]+}", async (c) => {
  const { username } = c.req.param();
  const viewer = await getUser(c);

  const userRow = await c.env.DB.prepare(
    `SELECT id FROM users WHERE username = ?`
  ).bind(username).first<{ id: string }>();

  if (!userRow) {
    return c.html(notFoundPage(username), 404);
  }

  const dispatch = await c.env.DB.prepare(
    `SELECT html, week_key, generated_at FROM dispatches WHERE user_id = ?`
  ).bind(userRow.id).first<{ html: string; week_key: string; generated_at: number }>();

  const isOwner = viewer?.username === username;

  if (!dispatch) {
    return c.html(noDispatchPage(username, isOwner));
  }

  return c.html(dispatchPage(username, dispatch, isOwner));
});

// ── templates ─────────────────────────────────────────────────────────────────

function homePage(user: { username: string; avatar_url: string } | null): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>gitzette — your weekly open-source dispatch</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Georgia', serif; background: #f7f4ee; color: #0f0f0f; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; }
  .masthead { font-family: monospace; font-size: clamp(48px, 10vw, 96px); font-weight: 700; letter-spacing: -.04em; margin-bottom: 8px; }
  .tagline { font-size: 16px; color: #666; margin-bottom: 40px; font-style: italic; }
  .btn { display: inline-block; padding: 12px 28px; background: #0f0f0f; color: #f7f4ee; font-family: monospace; font-size: 14px; font-weight: 600; text-decoration: none; letter-spacing: .05em; }
  .btn:hover { background: #333; }
  .user-bar { display: flex; align-items: center; gap: 10px; font-family: monospace; font-size: 13px; }
  .avatar { width: 28px; height: 28px; border-radius: 50%; }
  .rule { width: 100%; max-width: 480px; border: none; border-top: 1px solid #c8c2b4; margin: 24px 0; }
  .example { font-family: monospace; font-size: 12px; color: #888; }
  .example a { color: #0f0f0f; }
</style>
</head>
<body>
  <div class="masthead">gitzette</div>
  <div class="tagline">your weekly open-source dispatch, auto-generated</div>
  ${user
    ? `<div class="user-bar">
        <img src="${user.avatar_url}" class="avatar" alt="">
        <span>@${user.username}</span>
        &nbsp;·&nbsp;
        <a href="/${user.username}" style="font-family:monospace;color:#0f0f0f;">view my dispatch →</a>
        &nbsp;·&nbsp;
        <a href="/auth/logout" style="font-family:monospace;color:#888;font-size:11px;">sign out</a>
       </div>`
    : `<a href="/auth/github" class="btn">Sign in with GitHub</a>`
  }
  <hr class="rule">
  <div class="example">example: <a href="/NikolayS">gitzette.online/NikolayS</a></div>
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
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root { --ink: #0f0f0f; --paper: #f7f4ee; --rule: #c8c2b4; --muted: #666; }
  body { background: #e8e4dc; font-family: 'Georgia', serif; color: var(--ink); }
  a { color: var(--ink); text-decoration: none; border-bottom: 1px solid var(--rule); }
  a:hover { border-bottom-color: var(--ink); }
  .paper { max-width: 900px; margin: 24px auto; background: var(--paper); border: 1px solid var(--rule); padding: 32px; box-shadow: 0 2px 12px rgba(0,0,0,.12); }
  .header { border-bottom: 3px solid var(--ink); padding-bottom: 12px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: baseline; }
  .masthead { font-family: monospace; font-size: 32px; font-weight: 700; letter-spacing: -.03em; }
  .meta { font-family: monospace; font-size: 11px; color: var(--muted); text-align: right; }
  .content { line-height: 1.7; }
  .content article { margin-bottom: 32px; padding-bottom: 32px; border-bottom: 1px solid var(--rule); }
  .content article:last-child { border-bottom: none; }
  .content h2 { font-size: 22px; margin-bottom: 8px; }
  .content h3 { font-size: 16px; margin-bottom: 8px; color: var(--muted); font-style: italic; font-weight: normal; }
  .content p { font-size: 15px; margin-bottom: 12px; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid var(--rule); font-family: monospace; font-size: 11px; color: var(--muted); display: flex; justify-content: space-between; }
  .regen-bar { background: #0f0f0f; padding: 10px 16px; display: flex; align-items: center; justify-content: space-between; max-width: 900px; margin: 0 auto 0; }
  .regen-bar span { color: #f7f4ee; font-family: monospace; font-size: 12px; }
  .regen-btn { background: none; border: 1px solid #f7f4ee; color: #f7f4ee; font-family: monospace; font-size: 12px; padding: 4px 12px; cursor: pointer; }
  .regen-btn:hover { background: #333; }
</style>
</head>
<body>
  ${isOwner ? `
  <div class="regen-bar">
    <span>@${username} · ${dispatch.week_key} · generated ${generatedDate}</span>
    <button class="regen-btn" onclick="regenerate()">regenerate</button>
  </div>` : ""}
  <div class="paper">
    <div class="header">
      <div class="masthead"><a href="/" style="border:none;">gitzette</a></div>
      <div class="meta">@${username}<br>${dispatch.week_key}</div>
    </div>
    <div class="content">
      ${dispatch.html}
    </div>
    <div class="footer">
      <span>gitzette.online/${username}</span>
      <span>generated from public GitHub activity</span>
    </div>
  </div>
  ${isOwner ? `<script>
  async function regenerate() {
    const btn = document.querySelector('.regen-btn');
    btn.disabled = true; btn.textContent = 'generating...';
    const res = await fetch('/generate', { method: 'POST' });
    const data = await res.json();
    if (data.error) {
      btn.textContent = data.message || data.error;
      setTimeout(() => { btn.disabled = false; btn.textContent = 'regenerate'; }, 4000);
    } else {
      btn.textContent = 'queued — check back in ~60s';
      setTimeout(() => location.reload(), 65000);
    }
  }
  </script>` : ""}
</body>
</html>`;
}

function noDispatchPage(username: string, isOwner: boolean): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>@${username} — gitzette</title>
<style>body{font-family:monospace;background:#f7f4ee;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px;}</style>
</head><body>
  <div style="font-size:32px;font-weight:700;">@${username}</div>
  <div style="color:#666;">No dispatch generated yet.</div>
  ${isOwner ? `<button onclick="fetch('/generate',{method:'POST'}).then(()=>location.reload())" style="padding:10px 24px;background:#0f0f0f;color:#f7f4ee;border:none;font-family:monospace;cursor:pointer;">generate now</button>` : ""}
  <a href="/" style="color:#888;font-size:12px;">← gitzette.online</a>
</body></html>`;
}

function notFoundPage(username: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>not found — gitzette</title>
<style>body{font-family:monospace;background:#f7f4ee;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px;}</style>
</head><body>
  <div style="font-size:32px;font-weight:700;">@${username}</div>
  <div style="color:#666;">User not found. Have they signed in?</div>
  <a href="/" style="color:#888;font-size:12px;">← gitzette.online</a>
</body></html>`;
}
