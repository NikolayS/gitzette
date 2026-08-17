# OAuth usage calibration

`ROLLING_7D_GLOBAL_GENERATION_LIMIT=100` is an initial operator guardrail for
jobs that begin provider work. It is not a claim that the dedicated ChatGPT
account has a published allowance of 100 jobs. OpenAI's public developer limits
describe API-key usage tiers; they do not define a fixed token or image quota
for this ChatGPT OAuth path. The effective account allowance must therefore be
verified from the dedicated account at activation and monitored in operation.

## What one job consumes

An active successful edition makes one editor call, two image-generation calls,
and two image-review calls. At the configured ceiling, the seven-day worst-case
successful shape is therefore 100 editor calls, 200 generated images, and 200
image-review calls. Quiet editions use no model or image calls. Retries can add
provider work before a job publishes, so the account's provider-side usage
window remains the authoritative safety signal.

At publish time the Worker stores these fields on the job row:

- `input_tokens` and `output_tokens`;
- `token_source`, one of `none`, `estimated`, or `provider`;
- `image_count`;
- `wall_time_ms`.

OpenClaw 2026.7.1-beta.5 does not include local capability token counts in its
JSON envelope. Until it does, token values are deterministic estimates of
UTF-8 bytes divided by four, rounded up, and are explicitly labeled
`estimated`. Image count and runner wall time are measured directly. `/status`
shows seven-day sums and the number of jobs using estimates; never present
estimated tokens as billing-grade provider usage.

## Activation and recalibration

Before enabling `gitzette-runner.service`, run the five canaries and capture the
dedicated account's usage window before and after with the runner's isolated
OpenClaw state:

```bash
sudo -u gitzette-runner env \
  HOME=/var/lib/gitzette-runner \
  XDG_CONFIG_HOME=/var/lib/gitzette-runner/.config \
  XDG_CACHE_HOME=/var/lib/gitzette-runner/.cache \
  OPENCLAW_STATE_DIR=/var/lib/gitzette-runner/.openclaw \
  OPENCLAW_CONFIG_PATH=/var/lib/gitzette-runner/.openclaw/openclaw.json \
  /var/lib/gitzette-runner/.bun/bin/openclaw infer model auth status --json
```

Keep the initial value of 100 only if the observed provider window leaves at
least 50 percent headroom after projecting the active-job call shape above.
Otherwise lower it before activation. Do not raise it from one successful run:
require at least the five canaries plus one complete weekly batch, compare the
private `/status` aggregate with the provider window, and preserve 50 percent
headroom for retries and provider-side variation. Recheck after a model, image
quality, prompt, account plan, or provider-limit change.

If the provider window is unavailable or the local aggregate diverges
materially from it, disable the runner and investigate. Do not add an API key or
another provider as a fallback.
