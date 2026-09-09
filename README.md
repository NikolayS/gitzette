# gitzette

Weekly open-source digest — auto-generated from GitHub activity, rendered as a newspaper.

Live at [gitzette.online](https://gitzette.online)

## How it works

Sign in with GitHub (`read:user` scope only — no repo access requested). A generation request is queued in Cloudflare D1. A private pull runner collects public GitHub evidence, writes a typed edition with GPT-6 Astra through ChatGPT OAuth, creates illustrations with GPT Image 2.5 Sunburst through the same subscription environment, and atomically publishes the validated result to R2.

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
- ChatGPT/Codex OAuth subscription (`gpt-6-astra`, `gpt-image-2.5-sunburst`)

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
bun run dev
bun run test:all
```

The Worker contains no AI provider key or fallback. `RUNNER_SECRET` authenticates only the narrow runner API; model OAuth credentials remain on the private host.
# Review gate

`main` requires `typecheck`, `samorev-gate`, and an exact-head `samorev` commit
status. The owner-authorized TARS runner invokes Tanya301/samorev out of band,
parses its blocking verdict, and posts the status through GitHub's statuses API.
The PR-triggered gate verifies the status belongs to the current SHA and was
created by immutable reviewer identity `samo-agent` (ID `280144521`). Branch
protection requires both that GitHub-Actions-app-
bound gate and the final external `samorev` status to succeed, including for
admins; neither a pending verdict nor a rewritten proxy check is sufficient.
Release tags are also fail closed: the deploy workflow accepts only a tag on
the current `main` merge commit and re-verifies the associated PR head's two
app-bound checks plus the final reviewer-published samorev status before touching
production.

If production canaries fail, disable `gitzette-runner.service` first. Existing
immutable editions remain available. Deploy the last verified Worker tag if the
control plane itself regressed; the additive D1 tables may remain unused and
must not be dropped. Generation stays disabled until a reviewed forward repair
and fresh canaries pass. Retired AI-provider credentials are not a rollback
mechanism and must not be restored as a silent fallback.

The Cloudflare scheduled handler dispatches by `controller.cron`: `7 * * * *`
only expires stale jobs and staging every hour, `17 13 * * 1` performs the
primary Monday enqueue after the prior week is complete in every time zone, and
`17 20 * * 1` performs an idempotent retry after the six-hour age-out window.
Both weekly branches perform their own stale-job sweep before enqueue; they do
not depend on the hourly trigger arriving on time. A staging cleanup failure is
logged per job and cannot poison the rest of the sweep or the weekly retry.
Cleanup is capped at 20 R2 pages per job and invocation; incomplete/error
prefixes enter the durable `artifact_cleanup_jobs` retry queue, appear on the
private `/status` page, and resume on the next hourly invocation.
The reviewed production configuration keeps both `CLEANUP_SWEEP_ENABLED=false`
and `WEEKLY_GENERATION_ENABLED=false`, so the scheduled handler cannot mutate
durable state until the dedicated runner is provisioned and its canaries pass.
Enable cleanup in a reviewed deployment before enabling weekly enqueue; weekly
generation fails closed if cleanup is not active. Once enabled, it enqueues the
nine retained profiles once per profile/week, with the retry restoring only
primary-run work that aged out before provider capacity began. `/status`
exposes the latest scheduled week and its rolling-seven-day scheduled-job count.
It also lists every weekly slot that aged out before provider work began during
the last 14 days. A nonzero list is an operator alert. These rows carry the
distinct terminal failure code
`scheduled generation aged out before provider start`. Sign in as the immutable
`ADMIN_USER_ID`, then `POST /generate` with
`{"forUsername":"<profile>","weekKey":"<week>"}` for every listed slot while
that ISO week is still eligible. Verify publication before clearing the
incident; after the Monday retry has run, the next Monday targets a different
week and is not recovery.

Once weekly generation is enabled, after the final Monday retry plus the
configured queue age-out window, `/status` also computes a distinct
`unfulfilled weekly slots after final retry` list for
every unsuppressed retained profile without a published job for that ISO week.
This catches a missed cron or total provider outage even when no job row was
ever created. A nonzero count must be acknowledged within one hour. Within four
hours of the alert, the on-call must use the same authenticated `POST /generate`
admin re-drive for every listed profile/week, or keep a generation-outage
incident open if the provider remains unavailable. The incident closes only
after each edition is published and the unfulfilled counter returns to zero;
merely queuing the jobs is not recovery.

Before changing `WEEKLY_GENERATION_ENABLED` to `true`, run
`bash scripts/check-weekly-profiles.sh` with production Cloudflare credentials.
The deployment workflow repeats this preflight and requires one `users` row for
every retained profile. If a row is missing, keep scheduling disabled. Either
have that account complete GitHub OAuth sign-in or add its GitHub numeric user
ID through a reviewed forward data migration after verifying the identity with
GitHub's `/users/{username}` API. Deploy and verify the row while the flag stays
false; enable scheduling only in a later reviewed deployment. Never fabricate
an ID or use the admin enqueue path as a seeding mechanism.

### Highlighted-profile opt-out and takedown

Every rendered edition carries a fixed, non-editor-controlled notice that it is
AI-generated from public GitHub activity. This is disclosure, not a claim of
consent or authorization. Runtime suppression and the takedown deadlines below
remain mandatory for any verified request.

The contact for an automated-profile opt-out or takedown is
[@NikolayS](https://github.com/NikolayS); open an issue in this repository with
the profile name and requested removal. The request must be acknowledged within
one hour. After verifying the request, the on-call must activate the runtime
suppression within 15 minutes and complete artifact removal within four hours,
including outside business hours. `@NikolayS` owns the response; the designated
production on-call maintainer with Cloudflare production access executes it.

The first response is a D1 write, not a code deployment:

```bash
./node_modules/.bin/wrangler d1 execute gitzette-db --remote --command \
  "INSERT INTO profile_suppressions(username,reason) VALUES(lower('octocat'),'verified opt-out') ON CONFLICT(username) DO UPDATE SET reason=excluded.reason,suppressed_at=unixepoch()"
```

This immediately removes the profile from home/profile/edition/image routes,
blocks manual and weekly enqueue, terminalizes newly claimed work, and prevents
an in-flight lease from publishing. Disable the weekly scheduler and runner as
additional containment, then remove the username from
`WEEKLY_PROFILE_USERNAMES` while retaining it in
`MANAGED_PROFILE_USERNAMES` in a reviewed follow-up. Do not delete the D1
suppression row during that deployment.

New illustration objects carry their owner ID and username in R2 custom
metadata, so the image route also returns 404 after suppression. For historical
objects without that metadata, R2 deletion is mandatory: enumerate every
`edition_versions.r2_key` and legacy `dispatches.r2_key` for the profile, fetch
those exact edition objects, record every referenced `illustrations/*` key, and
delete each exact edition and illustration key with the locked Wrangler
`r2 object delete ... --remote` command. Never use a bucket-wide prefix or
wildcard. Run the production smoke test and verify the profile route, every
edition route, and every recorded `/img/*` URL return 404 before closing the
request. The suppression row and managed registry entry prevent historical D1/R2
records from becoming public again. A later opt-in requires a reviewed decision
and explicit deletion of the suppression row.
