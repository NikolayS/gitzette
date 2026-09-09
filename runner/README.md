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

The shipped configuration uses keyed `agents.entries` for OpenClaw 2026.9.2.
Image selection is explicit on each `infer image generate --model` call; do not
restore the retired `agents.defaults.imageGenerationModel` setting. Validate the
configuration with the installed OpenClaw before attempting OAuth activation.
Public commit messages and PR/issue titles are untrusted third-party input. They
are serialized inside the hostile-evidence delimiter, never interpolated into a
shell, and reach an agent with `tools.deny=["*"]`, no channels, elevation off,
and `workspaceAccess=none`. The only accepted text result is then parsed and
validated against the exact evidence-bound edition schema before publication;
prompt text cannot grant tools, filesystem access, URLs, HTML, or unsupported
claims.
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

`StateDirectoryMode=0700` protects the systemd-created root. At runtime,
`ensurePrivateDirectory` opens every state/work directory with `O_NOFOLLOW`,
then uses that same file descriptor's `chmod(0700)` and `stat()` methods to
tighten a pre-existing `0755` directory without a path re-resolution race. The
runner filesystem test pins both the unit directive and the permissive-directory
regression.

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

Before activation, the operator must attach a written authorization/terms-of-use
determination for automated use of the dedicated account to the release record.
This repository does not assert that approval exists. Without that record the
runner and weekly scheduler remain disabled, even if device-code login works.

The runner classifies OpenClaw auth failures primarily from structured JSON
`status`, `statusCode`, and `code` fields; a bounded message matcher is only a
fallback for older OpenClaw output. An auth-class failure is sent to the control
plane as terminal `runner_auth_unavailable`, rather than consuming all five job
attempts. The journal event `oauth_auth_failure_alert` is emitted after three
consecutive auth-class failures. Independently, `runner_failure_alert` is
emitted after five consecutive failures of any class, so unknown provider
wording cannot suppress the operator signal.

Treat either alert as a total generation outage: disable the runner, inspect
the dedicated identity with the sealed `auth status` command, revoke the broken
session if it still appears active, and repeat device-code login as
`gitzette-runner`. Then rerun auth status plus the text and image canaries before
re-enabling the service. Never copy another account's state or install an
API-key fallback. The restore target is four hours from the first alert; an
outage may exceed that target when the provider or account owner is unavailable.
Existing editions remain served, and queued work fails closed or ages out
during the accepted generation outage.

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

## Model policy

Writing and illustration review use `openai/gpt-6-astra`; image generation
remains pinned to `openai/gpt-image-2`. Update the Worker publication validator
and the runner together: new active manifests must declare Astra provenance.
Do not enable the updated runner against a Worker still enforcing the older
text-model pin. Historical stored editions are not rewritten by this change.

GPT-Image-2.5 Sunburst and Flare are listed in the current OpenAI model catalog,
but availability through this dedicated subscription OAuth transport must be
proven before changing the image pin. API availability alone is insufficient.
