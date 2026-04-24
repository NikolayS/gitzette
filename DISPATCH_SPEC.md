# Gitzette Dispatch — Worker Spec

**This file is the source of truth for how the Worker generates a dispatch.**
Read it before touching `src/generate.ts` or adjusting any visual/editorial rule.
Each constraint lists *why* it exists — don't "optimize" a rule without understanding the trap it avoids.

See also: `../gitzette-dispatch/EDITORIAL.md` — the offline script's editorial guide (the Worker prompt mirrors it).

---

## Architecture

- **Worker** (`/Users/nik/github/gitzette`, this repo): Cloudflare Worker running at gitzette.online. `POST /generate` runs the full pipeline synchronously.
- **Script** (`/Users/nik/github/gitzette-dispatch`): offline generator, richer features, used for manual dispatches.
- **CF plan**: Workers **Paid** ($5/mo) — required. Free plan has 50-subrequest limit; one dispatch needs ~200. `[limits]` in `wrangler.toml` only affects local dev, not production.
- **Generation must be synchronous** (no `waitUntil`). `waitUntil` tasks get killed before a 3–5 minute Opus + illustration job completes.

## Admin mode

`POST /generate` accepts `{ weekKey, forUsername }`. If logged-in user is `NikolayS`, `forUsername` is honored — inserts the target into the `users` table with a UUID and GitHub avatar if missing. Any other user can only generate for themselves (quota-limited).

---

## LLM

- Model: `anthropic/claude-opus-4-5` via OpenRouter. **Not sonnet** — opus is funnier and gets the voice right. This is the single biggest lever on "entertaining vs boring".
- `max_tokens: 8000`. 3000 truncates JSON for users with 20+ active repos (simonw).
- Prompt embeds the full editorial guide inline. The rules that actually matter are LEAD-WITH-SITUATION (don't open with "@owner merged #N"), INLINE PR LINKS as `<a href="URL">#N</a>`, and MAX 8 ARTICLES.

## Repo discovery

- Fetch `/users/{username}/repos?per_page=100&sort=pushed`, take first 30 (**include forks**).
- For forks: pass `author={username}` on commits query (skip upstream merges), skip releases/PRs (those belong to upstream).
- Also run `/search/issues?q=author:{username}+is:pr+created:{from}..{to}` to catch **external contributions** (e.g. NikolayS's PRs to pgdogdev/pgdog, rust-postgres/rust-postgres, postgres-ai/*). External repos are shown with PR data only, no commits/releases.
- Quiet weeks (0 active repos) save a `<p>No activity this week.</p>` placeholder; no illustrations generated.

## README screenshots

- `getReadmeImages` fetches README images via the newspaperify VM (processes to newspaper style). Used for **non-fork own repos** only. Each article carries at most one screenshot.

---

## Illustrations (OpenAI `gpt-image-1`)

Exact parameters in `generateIllustration`:

```json
{
  "model": "gpt-image-1",
  "prompt": "<STYLE>" + subject,
  "n": 1,
  "size": "1024x1024",
  "background": "transparent",
  "output_format": "webp",
  "quality": "low",
  "output_compression": 60
}
```

- `size: "1024x1024"` is the **minimum** OpenAI supports. Can't go smaller.
- `output_format: "webp"` + `output_compression: 60`: file size ~230–290 KB. Default PNG is ~1 MB. Without `output_compression` or `quality: low`, webp is still ~1 MB. Both flags are needed.
- `background: "transparent"` only works with png/webp.
- Store in R2 as `illustrations/{slug}.webp`, serve from `/img/{slug}.webp` with `Cache-Control: public, max-age=31536000, immutable`.

## Illustration prompt (the STYLE prefix)

Must require: Victorian-era woodcut engraving, centered object occupying **~60% of frame with ~20% transparent margin each side**, **complex irregular silhouette**, pure black ink on fully transparent background, no borders/frames/text/labels. The 20% transparent margin is load-bearing even though we now use `circle(50%)` for shape-outside — it still prevents the object from being cropped at the edges.

---

## Image budget (per dispatch)

Enforced in code — do not relax without testing:

- `targetImageCount = clamp(2, round(articles.length * 0.4), 3)`
- **Always at least 2 AI illustrations** — they're the visual identity. `minAiCount = 2`. Set by user as non-negotiable.
- `maxScreenshots = max(0, targetImageCount - minAiCount)` (so README screenshots never absorb the whole budget).
- **Image is per-article, not per-repo.** LLM may legitimately write 5 articles for the same repo (e.g. levkk on pgdog). Pre-fix, all 5 shared one illustration. Store the URL on the article object as `a._img` and `a._isIllustration`.
- **Dedupe URLs across the dispatch.** If `generateIllustration` returns the same slug as another article (same illustrationPrompt), skip it — no two articles show the same pic.
- One image max per repo in a dispatch.

## Image CSS (`articleImg` helper)

```html
<div style="float:left;margin:0 12px 6px 0;width:140px;height:140px;shape-outside:circle(50% at 50% 50%);-webkit-shape-outside:circle(50% at 50% 50%);shape-margin:6px;">
  <img src="..." style="width:140px;height:140px;object-fit:contain;display:block;" alt="..." loading="lazy">
</div>
```

- Images float **left** (user preference; do not switch to right).
- `shape-outside: circle(50%)` — **not** `url(...)`. Woodcut cross-hatching has 30–40% transparent holes INSIDE the silhouette; `shape-outside: url()` reads the alpha channel and lets text flow THROUGH those gaps, visually overlapping the image. `circle(50%)` wraps text around the 140px circular boundary — still pretext-style, no overlap. Do not try `shape-image-threshold: 0.5` — same problem.
- `object-fit: contain` — prevents cropping for non-square aspect content.
- `loading="lazy"` — reduces initial page weight.
- Screenshots (not AI illustrations) use a separate treatment: `float:left; max-width:28%; border:1px solid var(--rule);` without shape-outside.

## Body PR link styling

```css
.body p a[href*="/pull/"], .body p a[href*="/issues/"] {
  border-bottom: 1px solid #a08878;
  color: #5a3a2a;
}
```

Subtle warm-brown underline — just enough that `#123` reads as a link without screaming for attention.

---

## Layout (broadsheet)

At viewport ≥ 1400 px, two papers sit side-by-side. Critical CSS in `buildHtml`:

```css
.broadsheet-wrap .paper {
  max-width: none;
  flex: 1 1 0;
  min-width: 0;     /* without this, edition-bar long text forces one paper to overflow */
  margin: 0;
  overflow: hidden; /* clamps paper to its flex width */
}
.broadsheet-wrap .masthead { font-size: clamp(24px, 3.5vw, 48px); } /* smaller in broadsheet */
```

`min-width: 0` is essential. Flex items default to `min-width: auto` which expands to content width — the edition-bar's long tagline would make p1 1078 px and p2 only 435 px.

---

## Week key logic (AoE, Monday-first)

All three functions (`pages.ts:currentWeekKey`, `generate.ts:weekKey/isoWeekKeyAoE`, `quota.ts:currentWeekKey`) must agree:

- AoE (UTC−12): subtract 12 h from now before computing.
- Monday as day 0 of the week: `(dow + 6) % 7`.
- ISO week year = year of the Thursday of the week.

`/generate` accepts `{ weekKey: "YYYY-WNN" }` to regenerate past weeks. Without it, defaults to Monday 00:00 AoE (= Mon 12:00 UTC) of the current week through now.

---

## Never forget

- Opus > Sonnet for copy. Cheaper sonnet *sounds* acceptable but produces boring output. Lev test: would a senior engineer forward this? If no, it's too flat.
- Images per **article**, not per repo.
- `shape-outside: circle()`, not `url()`. Not negotiable for woodcut style.
- At least 2 AI illustrations per dispatch, always.
- Unique URLs across every dispatch — dedupe at selection time and at generation time.
- Test changes by actually regenerating at least 2 users with different profile shapes (a quiet one like DHH, a busy one like simonw) and viewing the output. CSS changes require regeneration to take effect — the CSS is inlined in the R2 HTML.
