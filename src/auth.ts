import { Hono } from "hono";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import type { Env } from "./index";
import { normalizeGitHubUsername } from "./identifiers";

export const authRoutes = new Hono<{ Bindings: Env }>();

// redirect to GitHub OAuth
authRoutes.get("/github", (c) => {
  const state = crypto.randomUUID();
  setCookie(c, "oauth_state", state, { httpOnly: true, secure: true, maxAge: 600, path: "/", sameSite: "None" });
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", c.env.GITHUB_CLIENT_ID);
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", state);
  return c.redirect(url.toString());
});

// GitHub OAuth callback
authRoutes.get("/callback", async (c) => {
  const { code, state } = c.req.query();
  const savedState = getCookie(c, "oauth_state");
  deleteCookie(c, "oauth_state", { path: "/" });

  if (!code || !state || state !== savedState) {
    return c.text("Invalid OAuth state", 400);
  }

  // exchange code for access token
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
  if (!tokenData.access_token) {
    return c.text("GitHub OAuth failed: " + (tokenData.error ?? "unknown"), 400);
  }

  // fetch user profile
  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      "Authorization": `Bearer ${tokenData.access_token}`,
      "User-Agent": "gitzette.online",
    },
  });
  if (!userRes.ok) return c.text("GitHub user lookup failed", 502);
  const ghUser = await userRes.json() as { id: number; login: string; avatar_url: string };
  const username = typeof ghUser.login === "string" ? normalizeGitHubUsername(ghUser.login) : null;
  if (!Number.isInteger(ghUser.id) || !username) return c.text("GitHub user profile invalid", 502);

  const userId = String(ghUser.id);

  // upsert user
  await c.env.DB.prepare(
    `INSERT INTO users (id, username, avatar_url) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET username=excluded.username, avatar_url=excluded.avatar_url`
  ).bind(userId, username, ghUser.avatar_url).run();

  // create session (7 days)
  const token = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 86400;
  await c.env.DB.prepare(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`
  ).bind(token, userId, expiresAt).run();

  setCookie(c, "session", token, {
    httpOnly: true, secure: true,
    maxAge: 7 * 86400, path: "/", sameSite: "Lax",
  });

  return c.redirect(`/${username}`);
});

// sign out
authRoutes.get("/logout", async (c) => {
  const token = getCookie(c, "session");
  if (token) {
    await c.env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run();
  }
  deleteCookie(c, "session", { path: "/" });
  return c.redirect("/");
});

// helper: resolve session → user
export async function getUser(c: any): Promise<{ id: string; username: string; avatar_url: string; suppressed: number } | null> {
  const token = getCookie(c, "session");
  if (!token) return null;
  const now = Math.floor(Date.now() / 1000);
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.avatar_url,
       EXISTS(SELECT 1 FROM profile_suppressions ps WHERE ps.username=u.username COLLATE NOCASE) AS suppressed
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`
  ).bind(token, now).first() as { id: string; username: string; avatar_url: string; suppressed: number } | null;
  return row ?? null;
}
