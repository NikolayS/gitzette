# gitzette

Weekly open-source digest — auto-generated from GitHub activity, rendered as a newspaper.

Live at [gitzette.online](https://gitzette.online)

## How it works

Sign in with GitHub (`read:user` scope only — no repo access requested). gitzette scans your public repos using a server-side token and generates a weekly dispatch: commits, PRs, releases, written up in newspaper style by an LLM.

Your dispatch lives at `gitzette.online/@yourusername`.

## Quotas

- 3 manual regenerations per week per user (resets Monday)

Community-supported. [Sponsor the project](https://github.com/sponsors/NikolayS) to get more generations per week.

## Stack

- Cloudflare Workers (runtime)
- Cloudflare D1 (SQLite — users, sessions, quota, spend)
- Hono (routing)
- GitHub OAuth (`read:user`)
- OpenRouter (LLM copy generation)
- Google Imagen 4 (illustrations)

## Deploy

```bash
# create D1 database
wrangler d1 create gitzette-db

# update wrangler.toml with the returned database_id
# run schema
wrangler d1 execute gitzette-db --remote --file=schema.sql

# set secrets
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put GITHUB_TOKEN
wrangler secret put OPENROUTER_API_KEY
wrangler secret put GOOGLE_AI_KEY
wrangler secret put SESSION_SECRET

# deploy
wrangler deploy
```

## Development

```bash
bun install
wrangler dev
```
