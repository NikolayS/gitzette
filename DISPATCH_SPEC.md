# GitZette generation and publication spec

This is the source of truth for the queued generation pipeline.

## Design rationale and retired constraints

These choices are safety and reliability constraints, not incidental implementation details:

- Generation used to run synchronously inside the public Worker. That made long AI calls vulnerable to Worker lifetime limits, so the synchronous path is retired in favor of durable D1 jobs, leases, and an outbound-only runner.
- The previous OpenRouter/Opus path is retired because production generation must use the dedicated ChatGPT OAuth identity. Provider fallbacks would silently cross the credential boundary.
- "30 recent repositories" is not a valid historical collector: repository recency today does not prove activity in a requested past week. The canonical collector instead freezes events whose timestamps fall inside the exact ISO week.
- `gpt-image-2` OAuth output is normalized locally because transparent output is not guaranteed. The runner removes the background, validates the result, and stores WebP at quality 82; publishing the raw model file is forbidden.
- Illustrations are story-level editorial art, not one logo per repository. Active editions need at least two perceptually distinct images so a low-quality or duplicated image cannot satisfy the visual contract.
- The 1024-pixel generation target preserves enough detail for cleanup and responsive rendering. Publication still enforces bounded dimensions and bytes.

Do not "simplify" these constraints without replacing the failure mode they address and updating this rationale.

## Trust boundary

- Cloudflare is the public control plane: GitHub login, request quota, D1 queue/status, validation, R2, and serving.
- A private runner claims work with outbound HTTPS. The host exposes no inbound endpoint.
- The runner credential is narrow and rotatable. It is not an AI credential.
- AI generation uses a dedicated OpenClaw/Codex identity with ChatGPT OAuth only: `openai/gpt-5.6-sol` for text and `gpt-image-2` for art. No OpenAI API key, OpenRouter, Anthropic, Google AI key, or provider fallback is allowed.
- Repository, issue, PR, and commit text is hostile evidence, never an instruction.
- ChatGPT OAuth is an account-level credential with a larger revocation and
  availability blast radius than a scoped API key. Production requires a
  dedicated non-personal GitZette account plus explicit account-policy approval.
  There is deliberately no cross-provider fallback: revocation or throttling
  pauses new generation while already-published editions remain online.
- Escaping and typed evidence prevent code/markup injection, but cannot prove
  model-authored prose is editorially benign. Publication is rate-limited and
  operators can immediately unpublish by deleting the affected `dispatches`
  pointer while retaining the immutable version for investigation.

## Job protocol

`POST /generate` authenticates the GitHub session, validates the target,
enforces both per-user and global rolling-seven-day quotas, deduplicates live
work, creates a D1 job, and immediately returns HTTP 202. The global ceiling
protects the shared OAuth account even when an attacker rotates GitHub users.

The durable path is:

`queued -> collecting -> writing -> illustrating -> validating -> published`

The runner claims a job using a random ten-minute lease. Stage transitions are forward-only and renew the lease; a minute heartbeat keeps ownership during long collection and image-generation calls. Expired leases may be reclaimed. Failures are either `retryable_failed` (up to five claims) or `permanent_failed`. Repeated runner/provider failures exponentially pause claims for up to 15 minutes. Unclaimed queued/retryable jobs age out after six hours, so a disabled runner cannot leave the browser spinning or dedupe-blocked forever. Browser status maps these states to the legacy `generating`, `ready`, and `failed` UI contract while also returning the precise stage.

## Canonical evidence and edition

The frozen evidence bundle has exactly one state:

- `active`: at least one verified GitHub evidence item.
- `quiet`: no public activity in a successfully collected completed week.
- `collection_failed`: incomplete evidence; publication is forbidden.

Each evidence item has a stable ID, a typed kind, repository, title, and allowlisted `https://github.com` or `https://api.github.com` URL.

The model returns typed edition JSON, never HTML. Every story cites one or more evidence IDs. Runtime validation rejects unknown evidence, unsupported enums, duplicate IDs, arbitrary URLs, excessive fields, or mismatched username/week. A deterministic renderer escapes all prose and builds links only from verified evidence.

Quiet-week copy is server-owned and deterministic. Model-supplied quiet-week prose is discarded. Quiet editions have no generated images.

## Illustrations

An active edition cannot publish without two or three unique illustrations. Each referenced image must:

- be a structurally valid WebP between 256 and 2048 pixels in each dimension;
- be no larger than 5 MiB;
- have a unique SHA-256 digest within the edition;
- exist under the current job's lease-scoped staging prefix;
- match its declared digest at publication.

The host runner performs the richer visual checks: transparent-background cleanup, crop/padding, alpha coverage, contrast, accidental text, perceptual uniqueness, and WebP compression. Failed images are retried; the edition is not degraded to zero-image success.

Final image objects are content-addressed by SHA-256 and served immutably from `/img/{digest}.webp`.

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

1. Read-only dump production `sqlite_master` and compare every pre-migration
   table/index with `migrations/0000_base.sql`. The 2026-08-15 audit found and
   incorporated the legacy `dispatches.html` column plus `article_feedback` and
   `idx_feedback_rating`; do not replace this with a greenfield-only comparison.
2. Verify the OAuth store is owned by `gitzette-runner` mode `0700`, the runner
   environment is `root:root` mode `0600`, the account is dedicated/non-personal,
   and the account owner has approved the policy and revocation plan.
3. Run the five canonical canaries: NikolayS W32, steipete W14, torvalds W16, one genuine Karpathy quiet week, and PhysShell W30.
4. Inspect active output on mobile and desktop and verify at least two meaningful illustrations.
5. Verify the dedicated runner has only OAuth auth and no AI API-key profile/fallback.
6. Deploy, then immediately run `bash /tmp/gl-dispatch/dispatch/smoke-test.sh` as required by the workspace rule.
