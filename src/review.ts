import { Hono } from "hono";
import { getUser } from "./auth";
import type { Env } from "./index";

export const reviewRoutes = new Hono<{ Bindings: Env }>();

// ── helpers ───────────────────────────────────────────────────────────────────

function headTags(): string {
  return `<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%230f0f0f'/><text x='3' y='26' font-size='26' fill='%23f7f4ee' font-family='Georgia,serif' font-weight='700'>G</text></svg>">
<meta name="theme-color" content="#0f0f0f">`;
}

type Article = {
  headline: string;
  body: string;
};

/** Parse <h1>, <h2> or <h3> headlines + next <p> from dispatch HTML */
function parseArticles(html: string): Article[] {
  const articles: Article[] = [];
  // Match h1, h2 or h3 tags (h1 is used for lead articles)
  const headlineRe = /<h[123][^>]*>([\s\S]*?)<\/h[123]>/gi;
  let match: RegExpExecArray | null;

  // We'll work with the raw html indices to find the next <p> after each headline
  while ((match = headlineRe.exec(html)) !== null) {
    const rawHeadline = match[1].replace(/<[^>]+>/g, "").trim();
    if (!rawHeadline) continue;

    // Find the next <p> after this headline
    const afterHeadline = html.slice(match.index + match[0].length);
    const pMatch = afterHeadline.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    let body = "";
    if (pMatch) {
      body = pMatch[1].replace(/<[^>]+>/g, "").trim();
    }

    articles.push({ headline: rawHeadline, body });
  }
  return articles;
}

/** Return first 2 sentences from a paragraph */
function firstTwoSentences(text: string): string {
  const sentences = text.match(/[^.!?]*[.!?]+/g) || [];
  return sentences.slice(0, 2).join(" ").trim() || text.slice(0, 200);
}

/** Build the review page HTML */
function reviewPage(
  username: string,
  week_key: string,
  articles: Article[],
  isOwner: boolean,
  isAdmin: boolean,
  existingFeedback: Map<string, { rating: number; complaint: string | null }>
): string {
  const canApprove = isOwner || isAdmin;

  const articleCards = articles
    .map((a, i) => {
      const fb = existingFeedback.get(a.headline);
      const initRating = fb ? fb.rating : 0;
      const initComplaint = fb ? (fb.complaint || "") : "";
      return `
    <div class="article-card" data-index="${i}" style="border:1px solid var(--border);padding:20px 24px;margin-bottom:20px;background:var(--paper);">
      <div style="font-family:'Playfair Display',serif;font-size:18px;font-weight:700;line-height:1.3;margin-bottom:10px;color:var(--ink);">${escHtml(a.headline)}</div>
      <div style="font-family:'IBM Plex Mono',monospace;font-size:12px;line-height:1.7;color:#555;margin-bottom:16px;">${escHtml(firstTwoSentences(a.body))}</div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <button
          class="thumb-btn up-btn"
          data-headline="${escAttr(a.headline)}"
          data-body="${escAttr(a.body)}"
          onclick="vote(${i}, 1)"
          style="padding:6px 14px;border:1px solid var(--border);background:${initRating === 1 ? "var(--ink)" : "transparent"};color:${initRating === 1 ? "var(--paper)" : "var(--ink)"};font-family:'IBM Plex Mono',monospace;font-size:12px;cursor:pointer;font-weight:600;transition:all .15s;"
        >✓ good</button>
        <button
          class="thumb-btn down-btn"
          data-headline="${escAttr(a.headline)}"
          data-body="${escAttr(a.body)}"
          onclick="vote(${i}, -1)"
          style="padding:6px 14px;border:${initRating === -1 ? "2px solid #c00" : "1px solid var(--border)"};background:transparent;color:${initRating === -1 ? "#c00" : "var(--ink)"};font-family:'IBM Plex Mono',monospace;font-size:12px;cursor:pointer;font-weight:600;transition:all .15s;"
        >✗ bad</button>
        <input
          class="complaint-input"
          type="text"
          placeholder="reason (optional)"
          value="${escAttr(initComplaint)}"
          style="flex:1;min-width:160px;border:none;border-bottom:1px solid var(--border);background:transparent;font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--ink);padding:4px 0;outline:none;"
        >
        <span class="save-indicator" style="font-size:11px;color:#888;font-family:'IBM Plex Mono',monospace;"></span>
      </div>
    </div>`;
    })
    .join("\n");

  const articlesJson = JSON.stringify(
    articles.map((a) => ({ headline: a.headline, body: a.body }))
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Review @${username}/${week_key} — gitzette</title>
${headTags()}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=Playfair+Display:ital,wght@0,700;0,900;1,700;1,900&display=swap" rel="stylesheet">
<style>
  :root{--ink:#0f0f0f;--paper:#f7f4ee;--border:#ccc9c0;}
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'IBM Plex Mono',monospace;background:var(--paper);color:var(--ink);min-height:100vh;}
  a{color:var(--ink);text-decoration:none;}
  a:hover{text-decoration:underline;}
  .header{border-bottom:2px solid var(--ink);padding:12px 24px;display:flex;align-items:center;justify-content:space-between;gap:12px;}
  .wordmark{font-family:'Playfair Display',serif;font-weight:900;font-style:italic;font-size:28px;line-height:1;}
  .meta{font-size:11px;color:#666;letter-spacing:.04em;}
  .container{max-width:760px;margin:0 auto;padding:32px 24px;}
  .section-title{font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:#888;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid var(--border);}
  .thumb-btn:hover{opacity:.8;}
</style>
</head>
<body>
  <div class="header">
    <a href="/" class="wordmark">gitzette</a>
    <div class="meta">review · @${username} · ${week_key}</div>
    <a href="/${username}/${week_key}" style="font-size:11px;letter-spacing:.05em;border:1px solid var(--border);padding:4px 10px;">view dispatch →</a>
  </div>

  <div class="container">
    <div class="section-title">Article Feedback — ${articles.length} article${articles.length !== 1 ? "s" : ""}</div>

    ${
      articles.length === 0
        ? `<div style="color:#888;font-size:13px;padding:24px 0;">No articles found in this dispatch.</div>`
        : articleCards
    }

    ${
      canApprove && articles.length > 0
        ? `<div style="margin-top:32px;padding-top:20px;border-top:1px solid var(--border);">
        <button
          id="publish-btn"
          onclick="publish()"
          style="padding:10px 28px;background:var(--ink);color:var(--paper);font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:700;border:none;cursor:pointer;letter-spacing:.05em;"
        >Approve &amp; Publish</button>
        <div id="publish-msg" style="margin-top:10px;font-size:12px;color:#666;font-family:'IBM Plex Mono',monospace;"></div>
      </div>`
        : !canApprove
        ? `<div style="margin-top:24px;font-size:11px;color:#888;font-family:'IBM Plex Mono',monospace;">Sign in as owner to publish.</div>`
        : ""
    }
  </div>

  <script>
  const ARTICLES = ${articlesJson};
  const ratings = {};

  // Initialize from pre-existing feedback
  document.querySelectorAll('.article-card').forEach((card, i) => {
    const upBtn = card.querySelector('.up-btn');
    const downBtn = card.querySelector('.down-btn');
    const initUp = upBtn.style.background.includes('0f0f0f') || upBtn.style.background === 'var(--ink)';
    const initDown = downBtn.style.color === '#c00' || downBtn.style.color.includes('c00');
    if (initUp) ratings[i] = 1;
    if (initDown) ratings[i] = -1;
  });

  function vote(idx, rating) {
    const card = document.querySelectorAll('.article-card')[idx];
    const upBtn = card.querySelector('.up-btn');
    const downBtn = card.querySelector('.down-btn');
    const indicator = card.querySelector('.save-indicator');
    const complaint = card.querySelector('.complaint-input').value;

    // Toggle off if clicking same button
    if (ratings[idx] === rating) {
      rating = 0;
    }
    ratings[idx] = rating;

    // Update up button
    if (rating === 1) {
      upBtn.style.background = 'var(--ink)';
      upBtn.style.color = 'var(--paper)';
    } else {
      upBtn.style.background = 'transparent';
      upBtn.style.color = 'var(--ink)';
    }

    // Update down button
    if (rating === -1) {
      downBtn.style.border = '2px solid #c00';
      downBtn.style.color = '#c00';
    } else {
      downBtn.style.border = '1px solid var(--border)';
      downBtn.style.color = 'var(--ink)';
    }

    if (rating === 0) {
      indicator.textContent = '';
      return;
    }

    indicator.textContent = 'saving...';
    saveFeedback(idx, rating, complaint, indicator);
  }

  async function saveFeedback(idx, rating, complaint, indicator) {
    const article = ARTICLES[idx];
    try {
      const res = await fetch(window.location.pathname, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          headline: article.headline,
          body: article.body,
          rating,
          complaint: complaint || null,
        }),
      });
      if (res.ok) {
        indicator.textContent = rating === 1 ? '✓ saved' : '✗ saved';
        setTimeout(() => { indicator.textContent = ''; }, 2000);
      } else {
        indicator.textContent = 'error';
      }
    } catch(e) {
      indicator.textContent = 'error';
    }
  }

  // Also save on complaint input blur/change if already rated
  document.querySelectorAll('.complaint-input').forEach((input, i) => {
    input.addEventListener('change', () => {
      const r = ratings[i];
      if (r && r !== 0) {
        const indicator = document.querySelectorAll('.save-indicator')[i];
        indicator.textContent = 'saving...';
        saveFeedback(i, r, input.value, indicator);
      }
    });
  });

  async function publish() {
    const btn = document.getElementById('publish-btn');
    const msg = document.getElementById('publish-msg');
    btn.disabled = true;
    btn.textContent = 'publishing...';
    try {
      const res = await fetch('/${username}/${week_key}/publish', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        msg.textContent = '✓ Published';
        btn.textContent = 'Published';
        window.location.href = '/${username}/${week_key}';
      } else {
        msg.textContent = data.error || 'Failed';
        btn.disabled = false;
        btn.textContent = 'Approve & Publish';
      }
    } catch(e) {
      msg.textContent = 'Network error';
      btn.disabled = false;
      btn.textContent = 'Approve & Publish';
    }
  }
  </script>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escAttr(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ── GET /review/:username/:week_key ──────────────────────────────────────────

reviewRoutes.get("/:username/:week_key", async (c) => {
  const { username, week_key } = c.req.param();

  // Auth check
  const user = await getUser(c);
  const isAdmin = c.req.header("x-session-secret") === c.env.SESSION_SECRET;
  const isOwner =
    isAdmin || (!!user && user.username.toLowerCase() === username.toLowerCase());

  if (!isOwner) {
    return c.text("Unauthorized — sign in as dispatch owner", 401);
  }

  // Fetch dispatch HTML from R2
  const r2Key = `dispatches/${username}/${week_key}.html`;
  const obj = await c.env.DISPATCHES.get(r2Key);
  if (!obj) {
    return c.text("Dispatch not found", 404);
  }
  const dispatchHtml = await obj.text();

  // Parse articles
  const articles = parseArticles(dispatchHtml);

  // Load existing feedback
  const existingRows = await c.env.DB.prepare(
    `SELECT headline, rating, complaint FROM article_feedback
     WHERE username = ? AND week_key = ? AND source = 'human'`
  )
    .bind(username, week_key)
    .all<{ headline: string; rating: number; complaint: string | null }>();

  const existingFeedback = new Map<string, { rating: number; complaint: string | null }>();
  for (const row of existingRows.results) {
    existingFeedback.set(row.headline, { rating: row.rating, complaint: row.complaint });
  }

  return c.html(reviewPage(username, week_key, articles, isOwner, isAdmin, existingFeedback));
});

// ── POST /review/:username/:week_key ─────────────────────────────────────────

reviewRoutes.post("/:username/:week_key", async (c) => {
  const { username, week_key } = c.req.param();

  // Auth check
  const user = await getUser(c);
  const isAdmin = c.req.header("x-session-secret") === c.env.SESSION_SECRET;
  const isOwner =
    isAdmin || (!!user && user.username.toLowerCase() === username.toLowerCase());

  if (!isOwner) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let body: { headline?: string; body?: string; rating?: number; complaint?: string | null };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const { headline, body: articleBody, rating, complaint } = body;

  if (!headline || !articleBody || (rating !== 1 && rating !== -1)) {
    return c.json({ error: "Missing or invalid fields" }, 400);
  }

  // Check if row already exists, then insert or update
  const existing = await c.env.DB.prepare(
    `SELECT id FROM article_feedback
     WHERE username = ? AND week_key = ? AND headline = ? AND source = 'human'`
  )
    .bind(username, week_key, headline)
    .first<{ id: number }>();

  if (existing) {
    await c.env.DB.prepare(
      `UPDATE article_feedback SET rating = ?, complaint = ? WHERE id = ?`
    )
      .bind(rating, complaint ?? null, existing.id)
      .run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO article_feedback (username, week_key, headline, body, rating, complaint, source)
       VALUES (?, ?, ?, ?, ?, ?, 'human')`
    )
      .bind(username, week_key, headline, articleBody, rating, complaint ?? null)
      .run();
  }

  return c.json({ ok: true });
});

// ── GET /review/:username/:week_key/data ─────────────────────────────────────

reviewRoutes.get("/:username/:week_key/data", async (c) => {
  const { username, week_key } = c.req.param();

  // Auth check
  const user = await getUser(c);
  const isAdmin = c.req.header("x-session-secret") === c.env.SESSION_SECRET;
  const isOwner =
    isAdmin || (!!user && user.username.toLowerCase() === username.toLowerCase());

  if (!isOwner) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const rows = await c.env.DB.prepare(
    `SELECT id, headline, body, rating, complaint, source, created_at
     FROM article_feedback
     WHERE username = ? AND week_key = ?
     ORDER BY created_at DESC`
  )
    .bind(username, week_key)
    .all();

  return c.json({ feedback: rows.results });
});

// ── GET /review/examples ─────────────────────────────────────────────────────

reviewRoutes.get("/examples", async (c) => {
  const goldRows = await c.env.DB.prepare(
    `SELECT headline, body, rating, created_at
     FROM article_feedback
     WHERE rating = 1 AND source = 'human'
     ORDER BY created_at DESC
     LIMIT 5`
  )
    .all<{ headline: string; body: string; rating: number; created_at: number }>();

  const badRows = await c.env.DB.prepare(
    `SELECT headline, body, rating, created_at
     FROM article_feedback
     WHERE rating = -1 AND source = 'human'
     ORDER BY created_at DESC
     LIMIT 3`
  )
    .all<{ headline: string; body: string; rating: number; created_at: number }>();

  return c.json({
    gold: goldRows.results,
    bad: badRows.results,
  });
});

// ── POST /review/:username/:week_key/publish ──────────────────────────────────
// Placeholder for "Approve & Publish" — makes the dispatch publicly visible.
// For now we just mark the dispatch as reviewed by inserting a sentinel.

reviewRoutes.post("/:username/:week_key/publish", async (c) => {
  const { username, week_key } = c.req.param();

  const user = await getUser(c);
  const isAdmin = c.req.header("x-session-secret") === c.env.SESSION_SECRET;
  const isOwner =
    isAdmin || (!!user && user.username.toLowerCase() === username.toLowerCase());

  if (!isOwner) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // The dispatch is already in R2 and publicly accessible — "publish" means
  // we've reviewed it. We don't need to do anything extra unless you want to
  // change visibility. For now, just return ok.
  return c.json({ ok: true });
});
