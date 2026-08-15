# Agent notes — GitZette Worker

Read `DISPATCH_SPEC.md` before changing generation, publication, queueing, or illustration rules.

## Non-negotiable architecture

- The Worker is a public control plane. It queues jobs, validates typed manifests and staged images, commits immutable versions, and serves R2 content.
- Generation happens only on the private pull runner. Do not add synchronous model calls or long `waitUntil` generation to the Worker.
- AI generation is ChatGPT/Codex OAuth subscription only: `openai/gpt-5.6-sol` and `gpt-image-2`. Never add an OpenAI, OpenRouter, Anthropic, or Google AI key/fallback.
- The model returns typed edition data, not HTML. Renderer escaping, evidence-ID links, image minimums, lease guards, and atomic pointer publication are security/correctness boundaries.

## Verification

Run `bun run test:all`. The E2E must exercise the real local Worker, D1, R2, HTTP queue/runner APIs, and public read path. A mocked handler test is not a replacement.

The former `claude-code-review.yml` workflow was removed because it could report
green without an available reviewer credential. The protected `main` branch now
requires a `samorev` commit status on the exact head SHA. Run the AI-analysis
surface of `Tanya301/samorev` after every post-review change and post its verdict
as that status; a prior SHA cannot satisfy the gate. Green CI alone is not a
review.

The status is published out-of-band by the owner-authorized TARS review runner:
it runs `Tanya301/samorev --blocking --fetch`, then posts the parsed verdict to
GitHub's commit-status API with context `samorev`, target URL set to the PR, and
the exact reviewed SHA. `samorev-gate.yml` accepts that status only from
`NikolayS`; branch protection requires the status itself to be `success`.

Before production activation, complete the canaries and mandatory post-deploy smoke test listed in `DISPATCH_SPEC.md`.
