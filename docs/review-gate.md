# Exact-head review gate

Protected `main` requires `typecheck`, `samorev`, and `samorev-gate` on the
exact pull-request head. It also requires a fresh CODEOWNER approval from
`@samo-agent`, dismisses stale approvals after a push, rejects approval by the
last pusher, applies to administrators, and requires every conversation to be
resolved.

The CODEOWNER approval is the identity boundary. GitHub Actions status names
are shared across workflows, and classic branch protection cannot bind a
user-published commit status to one user. A same-repository PR workflow can
request `statuses: write` even though the repository default is read-only, so it
can imitate all three required status names. The `samo-agent` approver must never
trust displayed check statuses: it approves only after its own exact-head
samorev process exits zero and it has read any `.github/workflows/**` changes.
Repository Actions cannot approve PRs, so a PR workflow cannot forge this
CODEOWNER decision.

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
code. The mention-driven Claude workflow is restricted to OWNER, MEMBER, or
COLLABORATOR-authored comments/reviews/issues, so arbitrary public commenters
cannot activate its OAuth credential.

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

## Full-delta review proof

PR #65 is one fail-closed cutover because its migrations, Worker lease routes,
host runner, and exact-head release gates have no independently deployable
intermediate state. The runner and weekly scheduler remain disabled, so merging
the coherent cutover does not activate generation. Splitting it would either
ship an unconsumed schema/API or require temporary compatibility paths that are
larger and less reviewable than the final boundary.

Every push invalidates the prior verdict and approval. The reviewer is invoked
with the PR URL and `--fetch`, so it receives the complete base-to-exact-head
delta; it is never invoked on `HEAD^..HEAD`. The posted report records the exact
head, total changed files/diff bytes, and CI result. A clean exit is followed by
an exact-head status and a fresh commit-bound approval. The current review has
already demonstrated full-delta coverage by finding interactions across D1
migrations, Worker scheduling/publication, the host runner, TypeScript project
configuration, and operational documentation in different fix rounds.

The mechanically verified full local gate is also complete-chain rather than
latest-commit-only: `bun run test:all` replays every migration, compares the
result with `schema.sql`, exercises Worker+D1+R2 E2E, and typechecks Worker,
scripts, runner source, and every runner test. `scripts/typecheck-config.test.ts`
fails if a runner test falls out of that TypeScript project.

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
bash scripts/apply-production-environment.sh
bash scripts/check-branch-protection.sh
bash scripts/check-production-environment.sh
```

Reading or changing live protection requires repository-administration access.
