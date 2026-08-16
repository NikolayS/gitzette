# Exact-head review gate

Protected `main` requires three exact-head status signals:

- `typecheck-gate`, emitted by the base-defined workflow after its separate,
  read-only job checks out and tests the exact PR head;
- `samorev`, the final exact-head Tanya301/samorev verdict published by the
  owner-authorized external runner;
- `samorev-gate`, explicitly published on the PR head by a
  `pull_request_target` workflow loaded from protected `main`, never from the
  pull-request head's workflow definition.

Classic branch protection also requires one approval from an identity other
than the author/last pusher, dismisses stale approvals after every push, applies
to admins, and requires all conversations resolved. Repository Actions are
forced to read-only defaults and are forbidden from approving pull requests, so
a PR-authored workflow cannot manufacture that approval with `GITHUB_TOKEN`.
The approval is an independent human-or-App trust decision, but classic branch
protection cannot constrain it to one specific eligible collaborator or App;
operator discipline still determines who may approve. The three status contexts
are required evidence and fail-closed orchestration, but they are not three
independent identities: GitHub Actions contexts are shared across workflows, and
classic protection cannot bind a user-published status to one user. The fresh
independent approval is the actual trust boundary.

The external runner attaches `samorev: pending` before review and replaces it
with `success`, `failure`, or `error` after parsing the blocking report. The
base-controlled publisher reads every status for the PR head, selects the newest
`samorev` status by creation time and ID, compares the
publisher's immutable GitHub user ID (`1345402`, login `NikolayS`, verified via
`gh api users/NikolayS --jq .id`), and passes only on final success. It never
checks out or executes PR-controlled code. Its own Actions check run belongs to
the base SHA and is deliberately not required; the `samorev-gate` commit status
it publishes belongs to the exact PR head SHA.

The gate publishes `samorev-gate: pending` immediately, retries transient GitHub
API failures every 30 seconds, and aborts after three consecutive API failures.
It otherwise waits up to 30 minutes for the review verdict. If a legitimate
review finishes after that window, or a failed review is replaced by a new final
verdict on the unchanged head, use GitHub's "Re-run failed jobs" action on the
unchanged PR head. Any code change creates a new head SHA and requires a
completely new review.

Because strict protection also requires the branch to be current with `main`,
using GitHub's "Update branch" creates a new SHA and therefore also requires a
fresh samorev verdict and App approval. This invalidation is intentional.

`config/main-branch-protection.json` is the reviewed policy and
`scripts/check-branch-protection.sh` compares it with live classic branch
protection, Actions workflow permissions, and the full details of effective
repository rulesets. The exact-match audit is intentional: even a hardening
change must be reviewed and committed with its matching policy update.

Reading live branch protection requires repository-administration read access.
Run the audit from the repository root or any other directory; the script
resolves its policy relative to itself.

App ID `15368` is GitHub Actions (`gh api /apps/github-actions --jq .id`). It
binds the expected status source to Actions but does not identify one particular
workflow. The required independent approval and the audited prohibition on
Actions-generated approvals supply the separate trust decision.

The base-defined test job runs PR code only on a fresh GitHub-hosted runner with
a read-only token and no declared secrets. The status-publisher job is separate
and never executes PR-controlled code. The ordinary PR-defined `typecheck`
workflow remains fast feedback, but it is not a protected trust signal.

Draft PRs publish a failing `samorev-gate` and become eligible only after they
are marked ready. Converting a reviewed PR back to draft re-runs the gate and
invalidates that eligibility.

## Requesting a verdict

The owner-authorized operator starts a review from a clean checkout of the PR
head with:

```bash
bun /home/tars/github/samorev/src/cli.ts review \
  https://github.com/NikolayS/gitzette/pull/NUMBER --blocking --fetch
```

Start it after every push, including an "Update branch", while the base gate's
30-minute polling window is active. The runner publishes `samorev: pending` and
then the terminal exact-head verdict. A later verdict on an unchanged head
requires re-running the failed gate job.

## Bootstrap sequence

The base-controlled workflow must exist on `main` before it can govern another
PR. Merge the small foundation PR only after its own exact-head typecheck and
samorev verdict pass. Then apply and verify the committed policy with:

```bash
bash scripts/apply-branch-protection.sh
bash scripts/check-branch-protection.sh
```

The apply script deliberately does not delete repository rulesets. If the audit
reports an unexpected effective ruleset, reconcile it manually and rerun the
audit; silently deleting an organization or repository policy is unsafe.
