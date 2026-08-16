# Exact-head review gate

Protected `main` requires `typecheck`, `samorev`, and `samorev-gate` on the
exact pull-request head. It also requires a fresh CODEOWNER approval from
`@samo-agent`, dismisses stale approvals after a push, rejects approval by the
last pusher, applies to administrators, and requires every conversation to be
resolved.

The CODEOWNER approval is the identity boundary. GitHub Actions status names
are shared across workflows, and classic branch protection cannot bind a
user-published commit status to one user. A same-repository workflow can
therefore imitate any of the three required status names. Repository workflow
tokens default to read-only and cannot approve pull requests, and the required
CODEOWNER review prevents those imitated statuses from authorizing a merge.

The external runner uses the separate `samo-agent` credential. It publishes
`samorev: pending`, runs a blocking Tanya301/samorev review of the exact head,
and replaces the status with `success`, `failure`, or `error`. The
`pull_request_target` publisher is loaded from protected `main`; it never checks
out or executes PR-head code. It accepts only a final status created after the
current gate run began and published by immutable user ID `280144521`
(`samo-agent`, verified with `gh api users/samo-agent --jq .id`). This timestamp
binding means every push, ready/draft transition, reopen, or PR edit requires a
new verdict.

`samorev-gate` is fail-closed orchestration, not a second identity boundary. It
publishes pending immediately, retries transient API/malformed-response failures
three times, and waits up to 30 minutes. A later verdict needs a failed-job
rerun. Strict protection means updating the branch creates a new head and
requires another review and approval.

The ordinary `pull_request` CI workflow runs all PR-controlled code in the PR
cache scope with a read-only token, no repository secrets, and no persisted Git
credential. The `pull_request_target` publisher executes only protected-main
code. Deployment credentials are available only to the protected `production`
environment; tag-triggered deploys require that environment's approval.

This gate protects merges, not compromised administrator credentials, installed
Apps, or secrets used by other event-triggered workflows. Actions holding
secrets must be commit-SHA pinned and must not check out or execute untrusted PR
code.

## Requesting and approving a verdict

After every push or PR edit, wait until `samorev-gate` is pending, then run from
a clean checkout of the PR head:

```bash
SAMOREV_HOME=/path/to/samorev
GH_TOKEN="$(gh auth token --user samo-agent)" \
  bun "$SAMOREV_HOME/src/cli.ts" review \
  https://github.com/NikolayS/gitzette/pull/NUMBER --blocking --fetch
```

Only after that exact-head review exits zero and CI is green may `samo-agent`
submit the CODEOWNER approval. Merge immediately after verifying the head SHA
has not changed.

## Policy audit and bootstrap

`config/main-branch-protection.json` is the reviewed policy.
`scripts/check-branch-protection.sh` exact-matches it against live classic branch
protection, Actions workflow permissions, and full repository or inherited
ruleset details. The apply script does not delete rulesets; unexpected rulesets
must be reconciled deliberately.

For the bootstrap PR, require its own exact-head CI, a clean samorev verdict,
and the separate `samo-agent` approval. Then apply and audit the committed
policy:

```bash
bash scripts/apply-branch-protection.sh
bash scripts/check-branch-protection.sh
bash scripts/check-production-environment.sh
```

Reading or changing live protection requires repository-administration access.
