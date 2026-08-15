# gitzette

Weekly open-source digest — auto-generated from GitHub activity, rendered as a newspaper.

Live at [gitzette.online](https://gitzette.online)

## How it works

Sign in with GitHub (`read:user` scope only — no repo access requested). A generation request is queued in Cloudflare D1. A private pull runner collects public GitHub evidence, writes a typed edition with GPT-5.6 Sol through ChatGPT OAuth, creates illustrations with GPT Image 2 through the same subscription environment, and atomically publishes the validated result to R2.

Your dispatch lives at `gitzette.online/@yourusername`.

## Quotas

- 3 manual regenerations per user in a rolling seven-day window
- 100 total generations across all users in a rolling seven-day window

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
# verify the one-time production baseline and apply versioned migrations
bun run db:migrate

# set secrets
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put SESSION_SECRET
wrangler secret put STATUS_TOKEN
wrangler secret put RUNNER_SECRET

# deploy
wrangler deploy
```

`bun run db:migrate` is the only supported production migration path. Never run
bare `wrangler d1 migrations apply ... --remote`: that bypasses the live
pre-cutover schema assertion. The tag-deploy workflow enforces the wrapper
before every Worker deployment; after cutover, the D1 migration ledger controls
subsequent migrations.

## Development

```bash
bun install
wrangler dev
bun run test:all
```

The Worker contains no AI provider key or fallback. `RUNNER_SECRET` authenticates only the narrow runner API; model OAuth credentials remain on the private host.
# Review gate

`main` requires `typecheck`, `samorev-gate`, and an exact-head `samorev` commit
status. The owner-authorized TARS runner invokes Tanya301/samorev out of band,
parses its blocking verdict, and posts the status through GitHub's statuses API.
The PR-triggered gate verifies the status belongs to the current SHA and was
created by `NikolayS`; branch protection requires `success`, including for admins.
