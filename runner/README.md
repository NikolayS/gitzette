# GitZette isolated runner

The runner is an outbound-only controller. It accepts no HTTP requests and no
human prompts. It claims validated `username + ISO week` jobs, collects public
GitHub evidence through constructed `api.github.com` URLs, invokes one-shot
OpenClaw model/image capabilities through ChatGPT OAuth, validates the exact
typed result, and submits it under the current lease.
It renews the lease every 60 seconds while collection or inference is running;
the Worker rejects stale heartbeats and all writes from an expired lease.

The AI subprocesses receive a deliberately rebuilt environment containing only
OpenClaw's isolated state paths. They do not receive the GitHub token, runner
secret, AI API keys, TARS state, messaging configuration, or a tool-capable
agent session. The OpenClaw config denies every agent tool; text and images use
the direct `openclaw infer` capability surface. It intentionally contains no
Gateway block, and the systemd service never starts a Gateway process.
The editor receives newest-first evidence capped at 64 KiB of serialized UTF-8,
keeping the single prompt argument below Linux's per-argument limit even when
the collector reaches its 500-item ceiling. The complete evidence bundle
remains the publication validator's source of truth.

Production layout:

- system user and group: `gitzette-runner`
- application: `/opt/gitzette-runner`, root-owned and read-only to the runner
- state/OAuth/work files: `/var/lib/gitzette-runner`, mode `0700`
- secrets: `/etc/gitzette-runner/environment`, root-owned mode `0600`
- service: `gitzette-runner.service`, with no inbound listener and a restrictive
  systemd filesystem/capability policy

The service must remain disabled until the Worker migration is deployed and the
narrow `RUNNER_SECRET` is configured on both sides. Never put an AI API key in
the environment file; startup rejects broad credential patterns and known AI
provider variables. `bun.lock` is the sole dependency lockfile used by CI.

OpenClaw 2026.7 does not import OAuth material from a legacy `~/.codex`
directory. Do not copy another user's Codex files into this account or treat
their presence as proof of usable runner auth. After the dedicated GitZette
account and revocation policy are approved, authenticate directly into the
isolated OpenClaw store as the service user:

```bash
sudo -u gitzette-runner env -i \
  HOME=/var/lib/gitzette-runner \
  PATH=/var/lib/gitzette-runner/.bun/bin:/usr/local/bin:/usr/bin:/bin \
  OPENCLAW_STATE_DIR=/var/lib/gitzette-runner/.openclaw \
  OPENCLAW_CONFIG_PATH=/var/lib/gitzette-runner/.openclaw/openclaw.json \
  /var/lib/gitzette-runner/.bun/bin/openclaw models auth login \
    --provider openai --device-code
```

Run the same sealed environment with `openclaw infer model auth status --json`
and require an available OpenAI OAuth route with no fallback before running the
text and image canaries. Missing, expired, or rate-limited auth keeps the
service disabled. Never add an API key to make a canary pass.

Provisioning must verify the credential boundary before enabling the service:

```bash
install -d -o gitzette-runner -g gitzette-runner -m 0700 /var/lib/gitzette-runner
install -o root -g root -m 0600 /dev/null /etc/gitzette-runner/environment
install -o root -g root -m 0644 runner/imagemagick/policy.xml /etc/ImageMagick-6/policy.xml
stat -c '%U:%G %a %n' /var/lib/gitzette-runner /etc/gitzette-runner/environment
```

Expected ownership/modes are `gitzette-runner:gitzette-runner 700` and
`root:root 600`. The OAuth identity must be a dedicated GitZette account, never
a person's primary ChatGPT identity. Account-policy approval and a tested
revocation response are production activation gates; if OAuth is revoked or
limited, generation intentionally fails closed and operators disable the runner
while existing editions remain available.

The ImageMagick major version and policy path are pinned by provisioning. The
integration suite bind-mounts the shipped policy onto the real ImageMagick 6
configuration path and proves that a forbidden SVG coder invocation fails.
CI runs on Ubuntu 24.04 with ImageMagick `6.9.12-98 Q16` packages pinned to
`8:6.9.12.98+dfsg1-5.2build2`; production must use the same build and install
`runner/imagemagick/policy.xml` at `/etc/ImageMagick-6/policy.xml` before the
runner is enabled. The runner verifies that this file contains a deny-all coder
rule before accepting work.

`ROLLING_7D_USER_GENERATION_LIMIT` is per requester and
`ROLLING_7D_GLOBAL_GENERATION_LIMIT` protects the shared OAuth identity across
all requesters. The user limit rejects excess requests. The global limit is a
separate provider-capacity admission gate: eligible requests remain queued in
FIFO order, and the claim statement atomically reserves capacity by setting
`capacity_started_at` only when provider work begins. Reclaims reuse the same
reservation. Queued work ages out after six hours, so a saturated account does
not hard-refuse or leave a first-time user blocked for days.

Every successful job records input tokens, output tokens, token measurement
source, generated image count, and runner wall time on `generation_jobs` in the
same lease-guarded batch that publishes it. `/status` shows rolling-seven-day
aggregates. OpenClaw 2026.7.1-beta.5 does not expose token usage in its local
capability JSON, so the runner currently stores a deterministic UTF-8-byte/4
estimate and labels it `estimated`; if a future envelope supplies bounded
provider counts, it records them as `provider`. Image count and wall time are
measured directly. The initial 100-start setting, its worst-case call shape,
and the production calibration procedure are documented in
[`docs/usage-calibration.md`](../docs/usage-calibration.md).

The dedicated ChatGPT OAuth subscription is not an API-key billing account, so
the old API-dollar ledger does not represent its cost model. If the account
moves to metered billing, disable the runner until a reviewed monetary budget
gate is added.
