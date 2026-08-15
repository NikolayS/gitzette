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

Provisioning must verify the credential boundary before enabling the service:

```bash
install -d -o gitzette-runner -g gitzette-runner -m 0700 /var/lib/gitzette-runner
install -o root -g root -m 0600 /dev/null /etc/gitzette-runner/environment
stat -c '%U:%G %a %n' /var/lib/gitzette-runner /etc/gitzette-runner/environment
```

Expected ownership/modes are `gitzette-runner:gitzette-runner 700` and
`root:root 600`. The OAuth identity must be a dedicated GitZette account, never
a person's primary ChatGPT identity. Account-policy approval and a tested
revocation response are production activation gates; if OAuth is revoked or
limited, generation intentionally fails closed and operators disable the runner
while existing editions remain available.
