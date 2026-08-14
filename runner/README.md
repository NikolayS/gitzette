# GitZette isolated runner

The runner is an outbound-only controller. It accepts no HTTP requests and no
human prompts. It claims validated `username + ISO week` jobs, collects public
GitHub evidence through constructed `api.github.com` URLs, invokes one-shot
OpenClaw model/image capabilities through ChatGPT OAuth, validates the exact
typed result, and submits it under the current lease.

The AI subprocesses receive a deliberately rebuilt environment containing only
OpenClaw's isolated state paths. They do not receive the GitHub token, runner
secret, AI API keys, TARS state, messaging configuration, or a tool-capable
agent session. The OpenClaw config denies every agent tool; text and images use
the direct `openclaw infer` capability surface.

Production layout:

- system user and group: `gitzette-runner`
- application: `/opt/gitzette-runner`, root-owned and read-only to the runner
- state/OAuth/work files: `/var/lib/gitzette-runner`, mode `0700`
- secrets: `/etc/gitzette-runner/environment`, root-owned mode `0600`
- service: `gitzette-runner.service`, with no inbound listener and a restrictive
  systemd filesystem/capability policy

The service must remain disabled until the Worker migration is deployed and the
narrow `RUNNER_SECRET` is configured on both sides. Never put an AI API key in
the environment file; startup rejects the known provider key names.
