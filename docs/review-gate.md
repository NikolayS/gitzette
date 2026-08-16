# Exact-head review gate

Protected `main` requires three independent signals:

- `typecheck`, emitted by GitHub Actions;
- `samorev`, the final exact-head Tanya301/samorev verdict published by the
  owner-authorized external runner;
- `samorev-gate`, emitted by a `pull_request_target` workflow loaded from
  protected `main`, never from the pull-request head.

The external runner attaches `samorev: pending` before review and replaces it
with `success`, `failure`, or `error` after parsing the blocking report. The
base-controlled gate reads the combined status for the PR head, compares the
publisher's immutable GitHub user ID (`1345402`), and passes only on final
success. It never checks out or executes PR-controlled code.

The gate retries transient GitHub API failures every 30 seconds for up to 30
minutes. If a legitimate review finishes after that window, use GitHub's
"Re-run failed jobs" action on the unchanged PR head; do not post a second
verdict or push an empty commit. Any code change creates a new head SHA and
requires a completely new review.

`config/main-branch-protection.json` is the reviewed policy and
`scripts/check-branch-protection.sh` compares it with live classic branch
protection. The exact-match audit is intentional: even a hardening change must
be reviewed and committed with its matching policy update.

## Bootstrap sequence

The base-controlled workflow must exist on `main` before it can govern another
PR. Merge the small foundation PR only after its own exact-head typecheck and
samorev verdict pass. Then apply the committed three-check protection policy
and verify it with:

```bash
bash scripts/check-branch-protection.sh
```
