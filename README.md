# gitzette

Weekly open-source digest — auto-generated from GitHub activity, rendered as a newspaper.

Live at [gitzette.online](https://gitzette.online)

## How it works

Sign in with GitHub (`read:user` scope only — no repo access requested). A generation request is queued in Cloudflare D1. A private pull runner collects public GitHub evidence, writes a typed edition with GPT-5.6 Sol through ChatGPT OAuth, creates illustrations with GPT Image 2 through the same subscription environment, and atomically publishes the validated result to R2.

Your dispatch lives at `gitzette.online/@yourusername`.

## Quotas

- 3 manual regenerations per week per user (resets Monday)

Community-supported. [Sponsor the project](https://github.com/sponsors/NikolayS) to get more generations per week.

## Stack

- Cloudflare Workers (public control plane)
- Cloudflare D1 (users, sessions, jobs, leases, immutable edition metadata)
- Cloudflare R2 (staged assets and published editions)
- Hono (routing)
- GitHub OAuth (`read:user`)
- Private OpenClaw pull runner (no inbound port)
- ChatGPT/Codex OAuth subscription (`gpt-5.6-sol`, `gpt-image-2`)

## Deploy

```bash
# create D1 database
wrangler d1 create gitzette-db

# update wrangler.toml with the returned database_id
# apply versioned migrations
wrangler d1 migrations apply gitzette-db --remote

# set secrets
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put GITHUB_TOKEN
wrangler secret put SESSION_SECRET
wrangler secret put RUNNER_SECRET

# deploy
wrangler deploy
```

## Development

```bash
bun install
wrangler dev
bun run test:all
```

The Worker contains no AI provider key or fallback. `RUNNER_SECRET` authenticates only the narrow runner API; model OAuth credentials remain on the private host.
