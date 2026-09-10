# GitZette generation and publication spec

This is the source of truth for the queued generation pipeline. Every retained
constraint records why it exists; do not "optimize" a rule without first
replacing the failure mode documented here.

## Design rationale and retired constraints

These choices are safety and reliability constraints, not incidental implementation details:

- Generation used to run synchronously inside the public Worker. That made long AI calls vulnerable to Worker lifetime limits, so the synchronous path is retired in favor of durable D1 jobs, leases, and an outbound-only runner.
- The previous OpenRouter/Opus path is retired because production generation must use the owner-authorized ChatGPT OAuth identity. Provider fallbacks would silently cross the credential boundary.
- "30 recent repositories" is not a valid historical collector: repository recency today does not prove activity in a requested past week. The canonical collector instead freezes events whose timestamps fall inside the exact ISO week.
- The Sunburst target keeps the previous image pipeline’s local background normalization; the September 9 OAuth canary confirmed opaque Sunburst generation and rejected direct transparent output. The complete locally processed image path passed; see docs/live-canary-2026-09-09.md. The runner removes the background, validates the result, and stores WebP at quality 82; publishing the raw model file is forbidden.
- Illustrations are story-level editorial art, not one logo per repository. Active editions need at least two perceptually distinct images so a low-quality or duplicated image cannot satisfy the visual contract.
- The 1024-pixel generation target preserves enough detail for cleanup and responsive rendering. Publication still enforces bounded dimensions and bytes.

Do not "simplify" these constraints without replacing the failure mode they address and updating this rationale.

### Legacy invariants: retained or explicitly superseded

- **Opus, not Sonnet** is superseded by the OAuth-only isolation boundary. The
  authorized account uses GPT-6 Astra; editorial quality is enforced by typed
  evidence plus the five human-inspected canaries, not a silent provider fallback.
- **`gpt-image-1`, quality low, WebP compression 60** is superseded by
  `gpt-image-2.5-sunburst` OAuth output followed by deterministic local cleanup and WebP
  quality 82. Raw model files are never published.
- **Illustrations per article, never per repository** is retained as story-level
  `illustrationKey` values. Keys and hashes must be unique, and active editions
  still require at least two illustrations.
- **`shape-outside: circle()`, never alpha-derived `url()`** remains the rule for
  legacy inlined editions. The new typed renderer intentionally uses a bounded
  fixed float instead of either shape function, eliminating the cross-hatch
  alpha-hole failure mode altogether.
- **Historical discovery must include external contributions and exact dates**
  is retained by the canonical evidence collector; current repository recency
  is not accepted as evidence for a past week.

## Trust boundary

- Cloudflare is the public control plane: GitHub login, request quota, D1 queue/status, validation, R2, and serving.
- A private runner claims work with outbound HTTPS. The host exposes no inbound endpoint.
- The runner credential is narrow and rotatable. It is not an AI credential.
- AI generation uses an isolated OpenClaw runner with the owner-authorized identity with ChatGPT OAuth only: `openai/gpt-6-astra` for text and `gpt-image-2.5-sunburst` for art. No OpenAI API key, OpenRouter, Anthropic, Google AI key, or provider fallback is allowed.
- Repository, issue, PR, and commit text is hostile evidence, never an instruction.
- ChatGPT OAuth is an account-level credential with a larger revocation and
  availability blast radius than a scoped API key. Nik authorized sharing his existing subscription for production on September 9;
  an isolated runner store is required, not a separate subscription.
  There is deliberately no cross-provider fallback: revocation or throttling
  pauses new generation while already-published editions remain online.
- Escaping and typed evidence prevent code/markup injection, but cannot prove
  model-authored prose is editorially benign. Publication is rate-limited and
  operators can immediately unpublish by deleting the affected `dispatches`
  pointer while retaining the immutable version for investigation.

## Job protocol

`POST /generate` authenticates the GitHub session, validates the target,
enforces the per-user rolling-seven-day request quota, deduplicates live work,
creates a D1 job, and immediately returns HTTP 202. The global rolling-seven-day
ceiling is enforced atomically when the runner claims provider work. Jobs above
that ceiling remain in FIFO order instead of returning a global 429; they start
as capacity recovers or visibly age out after six hours. This separates abuse
control from provider capacity, protects the shared OAuth account when an
attacker rotates GitHub users, and prevents one burst from hard-locking a
first-time user out for days.

The durable path is:

`queued -> collecting -> writing -> illustrating -> validating -> published`

The runner claims a job using a random ten-minute lease. Its first claim records
`capacity_started_at`; subsequent lease reclaims reuse that one global-capacity
reservation. Stage transitions are forward-only and renew the lease; a minute
heartbeat keeps ownership during long collection and image-generation calls.
Expired leases may be reclaimed. Failures are either `retryable_failed` (up to
five claims) or `permanent_failed`. Repeated runner/provider failures
exponentially pause claims for up to 15 minutes. Unclaimed queued/retryable jobs
age out after six hours, so a disabled or saturated runner cannot leave the
browser spinning or dedupe-blocked forever. Browser status maps these states to
the legacy `generating`, `ready`, and `failed` UI contract while also returning
the precise stage.

Successful publication records bounded per-job input/output token counts,
whether those counts came from the provider or the documented estimator, image
count, and runner wall time in the same lease-guarded D1 batch. The private
`/status` dashboard aggregates them over seven days. See
`docs/usage-calibration.md` for the 100-job initial ceiling and activation rule.

The scheduled handler dispatches three explicit Cloudflare Cron Triggers by
`controller.cron`. At minute 7 of every hour (`7 * * * *`) it only expires stale
jobs and removes their staging objects when the separately reviewed
`CLEANUP_SWEEP_ENABLED` gate is true; the committed default is false. Once
activated, cleanup remains independent of whether weekly enqueue is enabled.
At 13:17 UTC every Monday (`17 13 * * 1`), after the previous ISO week
is complete everywhere, it schedules that week for the nine retained weekly
profiles: NikolayS, DHH, dcramer, karpathy, levkk, mitchellh, simonw, steipete,
and torvalds. At 20:17 UTC (`17 20 * * 1`), more than the six-hour queue age-out
window later, it repeats the same idempotent enqueue so primary-run work that
never received provider capacity can be scheduled again. Both weekly branches
run their own stale-job sweep before enqueue, so retry correctness does not
depend on the hourly trigger arriving on time. Cleanup failures are logged per
job and cannot prevent other expired jobs or the weekly retry from progressing.
A weekly trigger fails closed if weekly generation is enabled before cleanup.
A durable unique key
per profile/week makes successful trigger redelivery a no-op and prevents an
already-finished edition from being regenerated. Weekly enqueue fails without
writing if the immutable admin principal or a retained profile is missing.

## Canonical evidence and edition

The frozen evidence bundle has exactly one state:

- `active`: at least one verified GitHub evidence item.
- `quiet`: no public activity in a successfully collected completed week.
- `collection_failed`: incomplete evidence; publication is forbidden.

Each evidence item has a stable ID, a typed kind, repository, title, and allowlisted `https://github.com` or `https://api.github.com` URL.

The model returns typed edition JSON, never HTML. Every story cites one or more evidence IDs. Runtime validation rejects unknown evidence, unsupported enums, duplicate IDs, arbitrary URLs, excessive fields, or mismatched username/week. A deterministic renderer escapes all prose and builds links only from verified evidence.

The legacy publication guards are retained by construction: an active edition
must contain at least one nonempty typed story, every story must resolve to
known collected evidence, and the deterministic renderer emits the required
article headline and body elements. This supersedes filtering free-form LLM
articles by repository name and scanning model-authored HTML after rendering.

Quiet-week copy is server-owned and deterministic. Model-supplied quiet-week prose is discarded. Quiet editions have no generated images.

## Illustrations

An active edition cannot publish without two or three unique illustrations. Each referenced image must:

- be a structurally valid WebP between 256 and 2048 pixels in each dimension;
- be no larger than 5 MiB;
- have a unique SHA-256 digest within the edition;
- exist under the current job's lease-scoped staging prefix;
- match its declared digest at publication.

The host runner performs the richer visual checks: transparent-background cleanup, crop/padding, alpha coverage, contrast, accidental text, perceptual uniqueness, and WebP compression. Any failed image fails the leased job attempt, and the whole job is retried under a fresh lease; the edition is not degraded to zero-image success.

Final image objects are namespaced by owner and content-addressed by SHA-256, then served immutably from `/img/{userId}-{digest}.webp`.

## Atomic publication

The runner uploads lease-scoped staging assets, then submits the manifest. The Worker validates it, verifies hashes, writes immutable image and edition objects, and uses a lease-guarded D1 batch to:

1. insert an immutable edition version only if the lease is still valid;
2. switch the public dispatch pointer only if that version exists;
3. mark the job published using the same lease.

A failed or expired regeneration cannot replace the previous edition. R2 orphans are harmless and can be garbage-collected; the D1 pointer defines what is public.

## Tests and release gate

CI must run:

```bash
bunx tsc --noEmit
bun test
bash scripts/e2e.sh
```

The E2E launches a real local Worker with isolated D1/R2 state and crosses HTTP boundaries from website request through runner auth, claim/lease, ordered stages, artifact upload, validation, immutable publication, and public read. It covers authentication/authorization, quota, deduplication, hostile markup escaping, active and quiet editions, image/hash failures, atomic regeneration rollback, and retry/reclaim.

Before production activation:

1. Run `scripts/check-production-baseline.sh`, which compares
   `migrations/0000_base.sql` with the committed read-only D1 fixture
   `fixtures/production-baseline-2026-08-15.sql`. The audit found and
   incorporated the legacy `dispatches.html` column plus `article_feedback` and
   `idx_feedback_rating`. Refresh that fixture from a new read-only remote
   `sqlite_master` dump before applying migrations; do not substitute the
   greenfield `schema.sql` equivalence check.
   `bun run db:migrate` enforces this for the one-time 0000/0001 cutover: it runs
   `scripts/check-production-drift.sh` against live D1 immediately before the
   first remote migration and aborts on any difference. Once the D1 migration
   ledger exists, subsequent migrations use that ledger and the pre-cutover
   fixture is intentionally skipped. Every migration run then compares live D1
   with a local replay of the complete reviewed chain and aborts deployment on
   structural drift. Out-of-band production DDL is forbidden. Refresh the
   fixture only before cutover in a reviewed commit after investigating drift.
   `bun run db:init:local` is local-only and initializes an empty development database
   from the migration chain.
2. Verify the OAuth store is owned by `gitzette-runner` mode `0700`, the runner
   environment is `root:root` mode `0600`, the subscription identity is the one authorized by Nik,
   and the shared-account revocation behavior is understood.
   Rotate `STATUS_TOKEN` independently with `wrangler secret put STATUS_TOKEN`;
   the dashboard accepts it only as `Authorization: Bearer ...`, never in URLs.
3. Run the five canonical canaries: NikolayS W32, steipete W14, torvalds W16, one genuine Karpathy quiet week, and PhysShell W30.
4. Inspect active output on mobile and desktop and verify at least two meaningful illustrations.
5. Verify the dedicated runner has only OAuth auth and no AI API-key profile/fallback.
6. Deploy, then immediately run `bash /tmp/gl-dispatch/dispatch/smoke-test.sh` as required by the workspace rule.

### Authorized subscription policy (September 9 update)

Nik explicitly authorized his existing OAuth subscription for both GitZette
canaries and production. A separate subscription is no longer a prerequisite.
The Linux runner and its auth store remain isolated. Sharing the subscription
means revocation, refresh-token rotation, throttling, and provider account actions
can affect both TARS and GitZette. GitZette serves multiple GitHub users, so its
load shares the owner account limits. No API-key
fallback is permitted. Only the authorized OAuth profile is copied, not another
agent's complete configuration or tool access.

The current copied profile shares a login session; filesystem isolation does not
isolate refresh/revocation effects. Recovery must coordinate both clients, or
establish a fresh runner login under the same authorized subscription. The
release record documents the owner request, not an invented legal determination
or an unrecorded acceptance of additional risks.
