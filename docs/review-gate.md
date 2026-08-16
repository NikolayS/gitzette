# Exact-head review gate

Protected `main` requires three independent signals:

- `typecheck`, the required correctness suite emitted by GitHub Actions (not an
  identity boundary by itself);
- `samorev`, the final exact-head Tanya301/samorev verdict published by the
  owner-authorized external runner;
- `samorev-gate`, emitted by a `pull_request_target` workflow loaded from
  protected `main`, never from the pull-request head.

Classic branch protection also requires one approval from an identity other
than the author/last pusher, dismisses stale approvals after every push, applies
to admins, and requires all conversations resolved. The owner-authorized agent
submits that exact-commit approval through the installed Codex GitHub App only
after independently classifying the final samorev report. A PR-authored Actions
workflow cannot impersonate that App review, and the PR author cannot approve
their own change.

The external runner attaches `samorev: pending` before review and replaces it
with `success`, `failure`, or `error` after parsing the blocking report. The
base-controlled gate reads the combined status for the PR head, compares the
publisher's immutable GitHub user ID (`1345402`, login `NikolayS`, verified via
`gh api users/NikolayS --jq .id`), and passes only on final success. It never
checks out or executes PR-controlled code.

The gate retries transient GitHub API failures every 30 seconds and aborts after
three consecutive API failures. It otherwise waits up to 30 minutes for the
review verdict. If a legitimate review finishes after that window, use GitHub's
"Re-run failed jobs" action on the unchanged PR head; do not post a second
verdict or push an empty commit. Any code change creates a new head SHA and
requires a completely new review.

Because strict protection also requires the branch to be current with `main`,
using GitHub's "Update branch" creates a new SHA and therefore also requires a
fresh samorev verdict and App approval. This invalidation is intentional.

`config/main-branch-protection.json` is the reviewed policy and
`scripts/check-branch-protection.sh` compares it with live classic branch
protection. The exact-match audit is intentional: even a hardening change must
be reviewed and committed with its matching policy update.

Reading live branch protection requires repository-administration read access.
Run the audit from the repository root or any other directory; the script
resolves its policy relative to itself.

## Bootstrap sequence

The base-controlled workflow must exist on `main` before it can govern another
PR. Merge the small foundation PR only after its own exact-head typecheck and
samorev verdict pass. Then apply the committed three-check protection policy
and verify it with:

```bash
bash scripts/check-branch-protection.sh
```
