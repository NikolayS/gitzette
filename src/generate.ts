import { Hono } from "hono";
import { getUser } from "./auth";
import { checkUserQuota, checkGlobalBudget, recordSpend, recordGeneration } from "./quota";
import type { Env } from "./index";

export const generateRoutes = new Hono<{ Bindings: Env }>();

// POST /generate — trigger dispatch generation for the signed-in user
generateRoutes.post("/", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "not authenticated" }, 401);

  const weeklyLimit = parseInt(c.env.WEEKLY_REGEN_LIMIT ?? "3");
  const monthlyBudget = parseFloat(c.env.MONTHLY_LLM_BUDGET_USD ?? "50");

  // check user quota
  const quota = await checkUserQuota(c.env.DB, user.id, weeklyLimit);
  if (!quota.allowed) {
    return c.json({
      error: "weekly_limit_reached",
      message: `You've used all ${quota.limit} generations this week. Resets Monday.`,
      used: quota.used,
      limit: quota.limit,
    }, 429);
  }

  // check global budget
  const budget = await checkGlobalBudget(c.env.DB, monthlyBudget);
  if (!budget.allowed) {
    return c.json({
      error: "global_budget_reached",
      message: "Monthly generation capacity is full. Try again next month.",
      spentUsd: budget.spentUsd,
      budgetUsd: budget.budgetUsd,
    }, 503);
  }

  // kick off generation (async — respond immediately, poll for result)
  // using waitUntil so the worker doesn't time out on the client
  const ctx = c.executionCtx;
  ctx.waitUntil(runGeneration(c.env, user));

  return c.json({ status: "queued", message: "Generation started. Check back in ~60 seconds." });
});

// GET /generate/status — poll for latest dispatch
generateRoutes.get("/status", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "not authenticated" }, 401);

  const row = await c.env.DB.prepare(
    `SELECT week_key, generated_at FROM dispatches WHERE user_id = ?`
  ).bind(user.id).first<{ week_key: string; generated_at: number }>();

  if (!row) return c.json({ status: "none" });
  return c.json({ status: "ready", week_key: row.week_key, generated_at: row.generated_at });
});

async function runGeneration(env: Env, user: { id: string; username: string }): Promise<void> {
  try {
    // date range: last 7 days
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 86400 * 1000);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    // scan public repos via server-side token
    const scanRes = await fetch(
      `https://api.github.com/users/${user.username}/repos?per_page=100&sort=pushed`,
      { headers: { "Authorization": `Bearer ${env.GITHUB_TOKEN}`, "User-Agent": "gitzette.online" } }
    );
    const repos = await scanRes.json() as Array<{ name: string; private: boolean; fork: boolean }>;
    const publicRepos = repos.filter(r => !r.private && !r.fork).map(r => r.name);

    if (publicRepos.length === 0) {
      await saveDispatch(env.DB, user.id, "<p>No public activity this week.</p>");
      return;
    }

    // collect commits/PRs per repo for the week
    const repoData = await collectActivity(env, user.username, publicRepos, fromStr, toStr);

    // generate copy via LLM
    const { html, costUsd } = await generateHtml(env, user.username, repoData, fromStr, toStr);

    // record quota + spend
    await recordGeneration(env.DB, user.id);
    await recordSpend(env.DB, costUsd);

    // save dispatch
    await saveDispatch(env.DB, user.id, html);
  } catch (err) {
    console.error("generation failed for", user.username, err);
  }
}

async function collectActivity(
  env: Env,
  username: string,
  repos: string[],
  from: string,
  to: string
): Promise<Array<{ repo: string; commits: number; prs: number }>> {
  const results = [];
  for (const repo of repos.slice(0, 20)) { // cap at 20 repos
    try {
      const commitsRes = await fetch(
        `https://api.github.com/repos/${username}/${repo}/commits?author=${username}&since=${from}T00:00:00Z&until=${to}T23:59:59Z&per_page=1`,
        { headers: { "Authorization": `Bearer ${env.GITHUB_TOKEN}`, "User-Agent": "gitzette.online", "Accept": "application/vnd.github.v3+json" } }
      );
      // GitHub returns Link header with total; parse last page or count items
      const commits = await commitsRes.json() as unknown[];
      if (!Array.isArray(commits) || commits.length === 0) continue;

      results.push({ repo, commits: commits.length, prs: 0 });
    } catch { /* skip repo */ }
  }
  return results;
}

async function generateHtml(
  env: Env,
  username: string,
  repoData: Array<{ repo: string; commits: number; prs: number }>,
  from: string,
  to: string
): Promise<{ html: string; costUsd: number }> {
  const summary = repoData.map(r => `- ${r.repo}: ${r.commits} commits`).join("\n");

  const prompt = `You are writing a weekly open-source digest for @${username} in newspaper style.
Active repos this week (${from} to ${to}):
${summary}

Write a short, punchy HTML dispatch. Use dry wit. Short sentences. Active voice. No emoji.
Return only the inner HTML content (no <html>/<body> wrapper) — articles as <article> tags with <h2> headlines.`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "anthropic/claude-haiku-4",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2000,
    }),
  });

  const data = await res.json() as {
    choices?: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  const content = data.choices?.[0]?.message?.content ?? "<p>Generation failed.</p>";
  // haiku ~$0.00025/1K input, $0.00125/1K output — rough estimate
  const tokens = (data.usage?.prompt_tokens ?? 0) + (data.usage?.completion_tokens ?? 0);
  const costUsd = (tokens / 1000) * 0.001;

  return { html: content, costUsd };
}

async function saveDispatch(db: D1Database, userId: string, html: string): Promise<void> {
  const { currentWeekKey } = await import("./quota");
  const week = currentWeekKey();
  await db.prepare(
    `INSERT INTO dispatches (user_id, week_key, html, generated_at) VALUES (?, ?, ?, unixepoch())
     ON CONFLICT(user_id) DO UPDATE SET week_key=excluded.week_key, html=excluded.html, generated_at=excluded.generated_at`
  ).bind(userId, week, html).run();
}
