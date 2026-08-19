# Agent notes — GitZette Worker

Before merging, follow [`docs/review-gate.md`](docs/review-gate.md). The former
automatic PR workflow `claude-code-review.yml` was removed; the mention-driven
`claude.yml` workflow remains. The canonical checks and merge-boundary
requirements live only in `docs/review-gate.md`.

Read `DISPATCH_SPEC.md` before changing generation, publication, queueing, or illustration rules.

## Non-negotiable architecture

- The Worker is a public control plane. It queues jobs, validates typed manifests and staged images, commits immutable versions, and serves R2 content.
- Generation happens only on the private pull runner. Do not add synchronous model calls or long `waitUntil` generation to the Worker.
- AI generation is ChatGPT/Codex OAuth subscription only: `openai/gpt-5.6-sol` and `gpt-image-2`. Never add an OpenAI, OpenRouter, Anthropic, or Google AI key/fallback.
- The model returns typed edition data, not HTML. Renderer escaping, evidence-ID links, image minimums, lease guards, and atomic pointer publication are security/correctness boundaries.

## Verification

Run `bun run test:all`. The E2E must exercise the real local Worker, D1, R2, HTTP queue/runner APIs, and public read path. A mocked handler test is not a replacement.

Green CI alone is not a review. The separate `samo-agent` identity runs
Tanya301/samorev on every exact head and publishes the immutable-creator verdict.
Formal GitHub approvals are intentionally not a gate. The sole repository
administrator may merge only that terminal-clean exact head after readiness;
the admin-only update ruleset prevents repository Actions from merging it.

Before production activation, complete the canaries and mandatory post-deploy smoke test listed in `DISPATCH_SPEC.md`.
