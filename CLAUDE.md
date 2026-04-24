# Claude notes — gitzette (Cloudflare Worker)

**Before modifying `src/generate.ts`, the generation prompt, image budget, CSS layout, or anything to do with how a dispatch looks: read `DISPATCH_SPEC.md` first.** It encodes the specific choices (Opus not Sonnet, `shape-outside: circle()` not `url()`, webp + `output_compression: 60`, min 2 AI pics per dispatch, image-per-article not per-repo, etc.) that each took a painful debugging cycle to land on. The *why* for every rule is in that file.

## Running the worker

- `npm run deploy` — deploys to Cloudflare Workers (requires `wrangler login` first).
- Generation is **synchronous** from `/generate` (a single fetch takes 3–5 minutes). Do not restructure it to use `waitUntil` — CF kills those tasks before Opus + illustrations finish.
- `POST /generate` body: `{ weekKey?: "YYYY-WNN", forUsername?: string }`. `forUsername` is honored only when the authenticated user is `NikolayS` (admin).
- The logged-in session cookie lives in the browser; when running ad-hoc generations for multiple users, do it from `https://gitzette.online` in a logged-in tab (via `fetch('/generate', ...)` in DevTools / the MCP browser tool). Curl without cookies returns 401.

## Sibling repo

`../gitzette-dispatch` is the offline generator script (different code, different CLI, richer features). Its `EDITORIAL.md` is the source of voice rules — the Worker prompt mirrors it.

## After any CSS or illustration change

The CSS is inlined into the HTML stored in R2. You must **regenerate** each dispatch for changes to be visible. "Deployed" does not mean "visible" for anything stylistic. Verify by screenshotting at least two users with different shapes (e.g. DHH with 1 article, simonw with 8) before declaring success.

## Common traps (pay off reading these)

- **"The text overlaps the image" / "I don't see pretext wrapping"** → you're using `shape-outside: url(...)` on a cross-hatched woodcut. Text flows through the 30–40% transparent gaps between ink strokes. Use `shape-outside: circle(50% at 50% 50%)` instead.
- **"File sizes are too heavy"** → `output_compression: 60` + `quality: "low"` on gpt-image-1 webp. Default is ~1 MB, with these flags ~250 KB.
- **"Text is boring"** → check `generateCopy` is using `claude-opus-4-5`, not sonnet. Sonnet produces acceptable-looking but flat copy.
- **"Two articles show the same picture"** → images are attached to *articles* as `a._img`, not to `repo.demoImages`. The LLM may write multiple articles per repo; each should render independently. Dedupe URLs across the dispatch.
- **"The 2nd page is gone / layout is broken at wide viewport"** → the first paper is absorbing all the width because flex items default to `min-width: auto`. Add `min-width: 0` and `overflow: hidden` to `.broadsheet-wrap .paper`.
- **"Only 3 active repos for a busy user"** → you're only looking at `/users/:username/repos`. Forks are filtered out by default, and external contributions (PRs to other orgs) aren't discovered. `runGeneration` must include forks (author-filtered) and run the Search API for PRs authored by the user.
- **"Generation timed out"** → either you're on the Free CF plan (50-subrequest limit blocks one dispatch) or you're using `waitUntil`. Both cases: fix the architecture, don't retry.
- **"subrequest_limit in wrangler.toml has no effect"** → that setting only applies to local dev. Production subrequest limit is set by the Workers plan.
