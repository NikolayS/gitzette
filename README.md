# gitzette

Weekly open-source digest — auto-generated from GitHub activity, rendered as a newspaper.

Live at [gitzette.online](https://gitzette.online)

## How it works

Sign in with GitHub (`read:user` scope only — no repo access requested). A generation request is queued in Cloudflare D1. A private pull runner collects public GitHub evidence, writes a typed edition with GPT-5.6 Sol through ChatGPT OAuth, creates illustrations with GPT Image 2 through the same subscription environment, and atomically publishes the validated result to R2.

Your dispatch lives at `gitzette.online/@yourusername`.

## Quotas

- 3 manual regenerations per user in a rolling seven-day window
- 100 jobs may begin provider work across all users in a rolling seven-day window

The global ceiling is enforced atomically by the runner claim, not by rejecting
otherwise eligible requests. Excess work stays in FIFO order and either starts
when capacity recovers or fails visibly after the six-hour queue-age limit. A
burst therefore cannot turn the global account guardrail into a multi-day hard
lockout for a first-time user. See [usage calibration](docs/usage-calibration.md)
for the telemetry and activation rule behind the initial 100-job setting.

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
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put SESSION_SECRET
wrangler secret put ADMIN_USER_ID
wrangler secret put STATUS_TOKEN
wrangler secret put RUNNER_SECRET

# deploy
wrangler deploy
```

`bun run db:migrate` is the only supported production migration path. Never run
bare `wrangler d1 migrations apply ... --remote`: that bypasses the live
pre-cutover schema assertion. The tag-deploy workflow enforces the wrapper
before every Worker deployment. After applying ledger-controlled migrations,
the wrapper also compares live D1 with a local replay of the complete reviewed
migration chain and aborts deployment on any column, index, trigger, or view
drift. Out-of-band production DDL is forbidden.

If the post-migration live-schema assertion fails, do not deploy the Worker and
do not edit the D1 migration ledger. Save the failed workflow URL and both
schema dumps, identify whether the difference came from the reviewed migration
or out-of-band DDL, and prepare a new forward-only repair migration. Re-run
`bun run db:migrate`; only deploy after live D1 matches the complete local chain.
Cloudflare D1 migrations have no automatic down path, so rollback means a
reviewed forward repair or restoring a verified pre-migration backup.

Before cutover, delete the retired Worker secrets `OPENROUTER_API_KEY`,
`OPENAI_API_KEY`, `GITHUB_TOKEN`, and `NEWSPAPERIFY_SECRET` with
`wrangler secret delete`, and revoke the corresponding provider-side keys.
`scripts/check-production-secrets.sh` enforces the exact remaining Worker secret
set and rejects any retired or unknown standing credential.

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
created by `NikolayS`. Branch protection requires both that GitHub-Actions-app-
bound gate and the final external `samorev` status to succeed, including for
admins; neither a pending verdict nor a rewritten proxy check is sufficient.
Release tags are also fail closed: the deploy workflow accepts only a tag on
the current `main` merge commit and re-verifies the associated PR head's two
app-bound checks plus the final owner-published samorev status before touching
production.

If production canaries fail, disable `gitzette-runner.service` first. Existing
immutable editions remain available. Deploy the last verified Worker tag if the
control plane itself regressed; the additive D1 tables may remain unused and
must not be dropped. Generation stays disabled until a reviewed forward repair
and fresh canaries pass. Retired AI-provider credentials are not a rollback
mechanism and must not be restored as a silent fallback.

The scheduled moderate-or-higher dependency audit opens or updates a GitHub
issue when it fails. GitHub may disable scheduled workflows after 60 days with
no repository activity; operators must treat a missing weekly run as a failure
and use `workflow_dispatch` to restore the cadence.
