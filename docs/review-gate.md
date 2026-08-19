# Exact-head review gate

Protected `main` requires `typecheck`, `samorev`, and `samorev-gate` on the
exact pull-request head, applies those checks to administrators, and requires
every conversation to be resolved. A separate formal GitHub approval is not a
merge or release gate. On 2026-08-19, the repository owner explicitly chose
this standing zero-formal-approval policy: each push is re-reviewed by the
independent exact-head samorev process, then Max performs a documented readiness
review before merge. The release runner (`samo-agent`, immutable ID `280144521`)
pushes the `v*` tag, and Nik performs the mandatory human authorization at the
protected production environment. The checked-in approval validator permits
only Nik and rejects the release actor.

The non-null zero-approval review policy still forces every change through a
pull request, so the protected-main publisher runs and conversation resolution
remains meaningful. `dismiss_stale_reviews`, `dismissal_restrictions`, and
`bypass_pull_request_allowances` are retained as fail-closed drift anchors, not
as active approval controls. Classic branch protection cannot bind a status to its
creator: any repository workflow with `statuses: write` runs as the shared
Actions app. The protected-main publisher itself validates the external
`samo-agent` status's immutable user ID and freshness before publishing its
result, and deployment revalidates the latest statuses. Before polling, the
base-controlled publisher fetches the exact PR ref without executing it, parses
every head workflow as YAML, and permits protected write authority only in the
base-controlled `pull_request_target` publisher. It also rejects any content
change to an already privileged workflow and any merge-base-to-head broadening
of `statuses: write`, `checks: write`, or `write-all` across trigger, workflow,
and job scope. Its tests cover
aliases/tags/folded values, large files, deletions, empty workflow diffs,
head-controlled trigger additions, existing privileged content changes, job-bound
privilege relocation, and missing permission blocks. Missing workflow and job
permissions grant nothing on the base side but are conservatively treated as
protected writes on the head side. This prevents an implicit base default from
authorizing an explicit PR write and does not depend on the repository default
remaining read-only. A repository-
level test pins `samorev-gate.yml` as the only workflow with `statuses: write`
or `checks: write`; the runtime audit independently enforces that same absolute
allowlist on every PR head. Because the privileged workflow cannot be changed by
a normal PR, a new step cannot inherit grandfathered write authority.

Classic branch protection enforces `samorev` by context name only because the
external user status has no bindable GitHub App ID. The immutable creator check
is performed by the protected-main poller, not by branch protection itself; the
poller's workflow, inputs, and permission/trigger boundary must therefore never
become PR-controlled. Deployment repeats the immutable creator check.

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
checks out protected-main code and audits workflow privilege changes before it
publishes pending, retries transient API/malformed-response failures three
times, and waits up to 30 minutes. A later verdict needs a failed-job
rerun. Strict protection means updating the branch creates a new head and
requires another complete review.

The ordinary `typecheck` job is defined by PR-head `ci.yml`, so its Actions app
identity is not a human or independent-code identity boundary. A PR can change
that job without requesting write permissions. The independent `samo-agent`
full-delta verdict is therefore the substantive review boundary; `typecheck`
remains a mandatory exact-head execution signal, and deploy revalidates both.

Classic branch protection cannot make the zero-approval merge itself
non-overwritable: every same-repository Actions workflow shares app ID `15368`,
and commit-status context names are last-writer-wins. Production release is the
sole non-overwritable authorization boundary. `samorev-gate` validates merge
evidence but is deliberately not described as an unforgeable identity. The
`production` environment permits only Nik to authorize `v*` tags plus the
temporary `main` credential-scope bootstrap, and forbids the workflow actor from approving
its own deployment. Normal release tags must be pushed by immutable user ID
`280144521` (`samo-agent`) and are authorized only by immutable owner ID
`1345402` (Nik). This makes the production authorizer independent from the
samorev verdict publisher. Both GitHub's `prevent_self_review` rule and the
checked-in approval validator reject the tag pusher as approver. The tag workflow first revalidates
the exact merged PR head,
immutable `samo-agent` verdict creator ID, and exact-head checks; only then can
the environment expose Cloudflare credentials. Those credentials must exist
only as environment secrets. Keeping either credential as a repository secret
would let a forged merge use a new `push` workflow to bypass the environment,
so `scripts/check-production-environment.sh` fails that configuration.

This environment review is a human owner release authorization, not a formal
GitHub pull-request approval. Run it only after a
terminal-clean exact-head review and readiness check; same-repository Actions
cannot approve their own environment deployment or read its secrets first.

The initial scope migration uses
`.github/workflows/migrate-production-credentials.yml` once, under that same
environment authorization. Only immutable user ID `280144521` (`samo-agent`)
may dispatch it, Nik must authorize the environment request, and both the RSA
public key and its fingerprint are pinned in the
reviewed workflow. It emits only an RSA-OAEP-SHA256 ciphertext for the
operator-held private key. Dispatch it from `main`; the temporary `main` branch
environment policy exists only for this bootstrap. After setting both
environment secrets and deleting the repository copies, delete the bootstrap
workflow in the next reviewed PR;
remove the temporary `main` policy in that same PR. Leaving a credential-export
path around is needless attack surface.

CI and `scripts/check-production-environment.sh` enforce that removal. The
temporary `main` environment policy and migration workflow must appear or
disappear together. Once the repository credential copies are absent, the
check fails if the migration workflow is still present on protected `main`.
The workflow never uploads an artifact or contains a decryption key; it prints
only ciphertext for the operator-held private key.

```bash
GH_TOKEN="$(gh auth token --user samo-agent)" \
  gh workflow run migrate-production-credentials.yml --ref main
```

Broadening a workflow's protected write set requires a three-PR recovery: first
land a narrowly scoped, exact-head-reviewed exception in the base parser; then
land the permission change under that protected-main exception; finally remove
the exception and re-audit branch protection. Never disable protection or make
the permission and its exception effective in the same head.

The ordinary `pull_request` CI workflow runs all PR-controlled code in the PR
cache scope with a read-only token, no repository secrets, and no persisted Git
credential. The `pull_request_target` publisher executes only protected-main
code. Deployment credentials are available only to the protected `production`
environment; tag-triggered deploys remain subject to that environment's
separate-identity protection. Never configure them as repository secrets.

## Artifact cleanup recovery

Each stale-job cleanup deletes at most 20 R2 pages in one invocation. An
incomplete or failed exact UUID prefix is persisted in
`artifact_cleanup_jobs`, shown as `Operator alert · artifact cleanup pending`
on the private `/status` page, and retried by the next hourly invocation.
Success removes the durable retry row.

If a row reaches three attempts or remains for three hours, acknowledge it
within one hour and set `WEEKLY_GENERATION_ENABLED=false` while leaving the
cleanup sweep enabled. Inspect only the displayed job UUID's
`staging/<job-uuid>/` prefix in the Cloudflare R2 console/API; never select
`staging/` or another broad prefix. Preserve incident evidence, delete only
objects under that exact validated UUID prefix, and let the next hourly sweep
prove the prefix empty and remove the alert. Do not edit the D1 retry row by
hand. Weekly generation stays disabled until `/status` shows zero pending
artifact cleanups and the incident has a reviewed root cause.

This gate protects merges, not compromised administrator credentials, installed
Apps, or secrets used by other event-triggered workflows. Actions holding
secrets must be commit-SHA pinned and must not check out or execute untrusted PR
code. The mention-driven Claude workflow is restricted to OWNER, MEMBER, or
COLLABORATOR-authored comments/reviews/issues, so arbitrary public commenters
cannot activate its OAuth credential.

## Requesting and publishing a verdict

After every push or PR edit, wait until `samorev-gate` is pending, then run from
a clean checkout of the PR head:

```bash
SAMOREV_HOME=/path/to/samorev
GH_TOKEN="$(gh auth token --user samo-agent)" \
  bun "$SAMOREV_HOME/src/cli.ts" review \
  https://github.com/NikolayS/gitzette/pull/NUMBER --blocking --fetch
```

Only after that exact-head review exits zero, its exact-head status is published,
the base-controlled publisher is green, and CI is green may the PR merge. Verify
the head SHA has not changed immediately before merging.

## Full-delta review proof

PR #65 is one fail-closed cutover because its migrations, Worker lease routes,
host runner, and exact-head release gates have no independently deployable
intermediate state. The runner and weekly scheduler remain disabled, so merging
the coherent cutover does not activate generation. Splitting it would either
ship an unconsumed schema/API or require temporary compatibility paths that are
larger and less reviewable than the final boundary.

The apparent support files are part of that same deployable boundary. The
independent publisher/reviewer foundation is no longer introduced by this PR:
PR #66 landed it on `main` at
`1aca7074f59b193466697a0290a11bd44bffed6e` before the current review cycle.
Every review in this cycle therefore runs under base-controlled code. The
remaining CI change installs the runner's pinned ImageMagick runtime and runs
the feature's complete-chain gate; the deploy change enforces this feature's
reviewed migration/secrets/head checks. The unrelated scheduled dependency
audit was removed from this cutover for a later independent PR. `bun.lock`
fixes the dependencies used by both the Worker and isolated host runner. The
runner `tsconfig` makes its
tests part of the required typecheck. The dispatch specification and runbooks
define the migration, credential, activation, takedown, smoke, and rollback
gates that keep the shipped scheduler and runner inert until an operator enables
them. Landing any of those separately would break exact dependency
reproducibility or detach the operational safety contract from the code it
controls; none is an independently activatable feature.

Every push invalidates the prior verdict. The reviewer is invoked
with the PR URL and `--fetch`, so it receives the complete base-to-exact-head
delta; it is never invoked on `HEAD^..HEAD`. The posted report records the exact
head, total changed files/diff bytes, and CI result. A clean exit is followed by
an exact-head status and an app-bound publisher result. The current review has
already demonstrated full-delta coverage by finding interactions across D1
migrations, Worker scheduling/publication, the host runner, TypeScript project
configuration, and operational documentation in different fix rounds.

The mechanically verified full local gate is also complete-chain rather than
latest-commit-only: `bun run test:all` replays every migration, compares the
result with `schema.sql`, exercises Worker+D1+R2 E2E, and typechecks Worker,
scripts, runner source, and every runner test. `scripts/typecheck-config.test.ts`
fails if a runner test falls out of that TypeScript project.

The current full-delta re-review ledger makes both changed and unchanged
attention explicit. Every row reran `bun run test:all`, E2E, typechecks,
actionlint, shellcheck, the high audit, and the secret scan before the linked
`--fetch` review:

| Exact head | Focus of that fix cycle | Unchanged subsets re-verified by the full gate | Full-delta report |
| --- | --- | --- | --- |
| `30b0be6` | structured OAuth outage signals and strict D1 response parsing | migrations, queue/publication, scheduler, renderer, and deploy gate | [report](https://github.com/NikolayS/gitzette/pull/65#issuecomment-5333994431) |
| `806ae6a` | credential scrub, cleanup activation, OAuth persistence, disclosure | runner inference/lease core, migration chain, publication transaction, and review foundation | [report](https://github.com/NikolayS/gitzette/pull/65#issuecomment-5334155893) |
| `c62ecea` | baseline derivation, post-retry visibility, prompt sandbox, scope extraction | migrations, Worker queue/lease/publication, host runner runtime, and protected review state machine | [report](https://github.com/NikolayS/gitzette/pull/65#issuecomment-5334329357) |
| `0a78b55` | fail-closed suppression types and durable artifact cleanup retry | Worker routes, runner isolation, migration chain, deploy permissions, and base-controlled review state machine | [report](https://github.com/NikolayS/gitzette/pull/65#issuecomment-5334570243) |

Each report records the complete base-to-head byte count, not only the focus
column. A later fix head invalidates the prior row and must add a new exact-head
report before merge.

The merge base and current protected `main` are both
`1aca7074f59b193466697a0290a11bd44bffed6e`. At that base, the
`.github/workflows/samorev-gate.yml` blob is
`9e21e49543ceee34d0d11d04721c2dd245b39b39`; the workflow checks out `main`,
never PR-head code, before running the publisher. Verify rather than trusting
this prose:

```bash
git fetch origin main
test "$(git merge-base origin/main HEAD)" = "$(git rev-parse origin/main)"
git rev-parse origin/main:.github/workflows/samorev-gate.yml
gh api 'repos/NikolayS/gitzette/contents/.github/workflows/samorev-gate.yml?ref=1aca7074f59b193466697a0290a11bd44bffed6e' --jq .sha
```

## Policy audit and bootstrap

`config/main-branch-protection.json` is the reviewed policy.
`scripts/check-branch-protection.sh` exact-matches it against live classic branch
protection, Actions workflow permissions, and full repository or inherited
ruleset details. The apply script does not delete rulesets; unexpected rulesets
must be reconciled deliberately.

For the bootstrap PR, require its own exact-head CI and a clean samorev verdict.
Then apply and audit the committed policy:

```bash
bash scripts/apply-branch-protection.sh
bash scripts/apply-production-environment.sh
bash scripts/check-branch-protection.sh
bash scripts/check-production-environment.sh
```

Reading or changing live protection requires repository-administration access.
