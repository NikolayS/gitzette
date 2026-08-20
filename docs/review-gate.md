# Exact-head review gate

Protected `main` currently displays `policy-api-readability`, `typecheck`,
`samorev`, and `samorev-gate` on the exact pull-request head and requires every
conversation to be resolved.
Those context names are not an identity boundary: a same-repository workflow
can request `statuses: write`, and GitHub Actions check names share app ID
`15368`. A GitHub `APPROVED` review is not accepted as merge or release
evidence. Branch protection requires a pull request but sets the approval count
to zero. A separate active ruleset restricts every `main` update to immutable
external user ID `280144521`; GitHub Actions and repository administrators are
not bypass actors and cannot merge even after forging all displayed contexts.
The external operator merges with the `samo-agent` credential only after
exact-head CI, terminal-clean samorev, resolved conversations, and readiness
review. Any push after a verdict invalidates it: merge requires a new
terminal-clean samorev verdict on the exact current head, and a green pipeline
is never a substitute.

Because `policy-api-readability` is required, every merge also depends on the
live GitHub environments API being readable and the `production` environment
existing. Repair or recreate that environment from the canonical config with
`scripts/apply-production-environment.sh`, then rerun CI. If an API outage makes
that impossible, merging waits for the API to recover. Removing the required
context is not an approved break-glass path: it would weaken the reviewed gate
while the credential window is open. Record the outage, keep #67 ready, and
rerun CI plus `scripts/check-branch-protection.sh` when the API is readable.

The external runner uses the separate `samo-agent` credential. It publishes
`samorev: pending`, runs a blocking Tanya301/samorev review of the exact head,
and replaces the status with `success`, `failure`, or `error`. The
`pull_request_target` publisher is loaded from protected `main`; it never checks
out or executes PR-head code. It accepts only a final status created after the
current gate run began and published by immutable user ID `280144521`
(`samo-agent`, verified with `gh api users/samo-agent --jq .id`). This timestamp
binding means every push, ready/draft transition, reopen, or PR edit requires a
new verdict.

Release enforcement does not trust those displayed names. The active
`release-tags-samo-only` tag ruleset restricts creation, update, and deletion
of `refs/tags/v*` to immutable user ID `280144521`; repository Actions and
other write credentials cannot bypass it. The reviewed tag
workflow queries GitHub's workflow-run records by exact path, event, same-repo
head, `main` base, and PR head SHA. These endpoints require only the job's
declared `actions: read`; admin-only protection/ruleset APIs are deliberately
kept out of the deploy job. The latest
`.github/workflows/samorev-gate.yml` run must also name `main` as its PR base
and `NikolayS/gitzette` as both its base and head repository. The workflow
requires the latest CI run and the publisher run targeted by the immutable
verdict to have succeeded. A later failed publisher run at the same head does
not invalidate that targeted evidence; before merge, its required
`samorev-gate` status still blocks until a new exact-head verdict succeeds. The
workflow separately requires the latest `samorev` status to come from immutable user ID `280144521`,
target that exact publisher run, and post after the run began.
The `pull_request` CI workflow is head-controlled evidence, not an identity
boundary; a PR can rewrite its own `ci.yml`. The unforgeable legs are the
protected-main `pull_request_target` run record and the external user's status.
A repository Actions token can publish the same context name, but GitHub
records that status under the Actions bot's immutable ID, not `280144521`, so
the gate rejects it. The `samo-agent` credential is not stored in repository or
environment secrets, must never be added there under any name, and is
unavailable to repository workflows or the self-hosted GitZette runner.
`scripts/check-reviewer-credential-isolation.sh` enforces that Actions variables
are only the two migration switches with value exactly `true` (`false` is
rejected as residue), Dependabot has no secrets,
repository secrets contain only the reviewed mention-driven Claude OAuth token
and the two temporary Cloudflare migration names, and every environment has no
variables while every non-production environment has no secrets. Its bare
pre-migration invocation accepts either an empty `production` secret set or the
exact reviewed Cloudflare pair. Set `REQUIRE_PRODUCTION_CREDENTIALS=true` to
prove both independently validated production names are installed; the external
readiness operator runs that inventory check with repository-administration
read access. Before
publishing success, the external reviewer must inspect every
`.github/workflows/**` change and every changed enforcement script under
`scripts/check-*.sh` in the full base-to-head delta. `.github/CODEOWNERS` still
documents ownership of the entire repository (`* @samo-agent`), including those
scripts, but is intentionally not a merge gate. The final
deploy job also requires Nik's approval in the non-bypassable `production`
environment.

Classic branch protection requires a pull request while its approval count is
zero. The active `main-samo-only-updates` ruleset permits only immutable user ID
`280144521` to update `main`, so neither a same-repository Actions token nor the
repository administrator can turn forged contexts into a merge. Repository
auto-merge is disabled and audited. The pre-apply inventory requires the only
administrator to be NikolayS (`1345402`). After mutation, the apply script
requires the administrator's `current_user_can_bypass` to be `never`, then
queries both rulesets with the non-admin `samo-agent` token and requires
`current_user_can_bypass` to be `always`. Merge does not authorize a release:
the tag workflow revalidates the external exact-head evidence, and its
deployment cannot read production credentials without a new approval from Nik
in the non-bypassable `production` environment. Repository Actions cannot mint
that environment approval. This is why a PR approval is redundant for the
release identity boundary without pretending that status names are equivalent
to approvals.

Administrator policy authorization is explicit: Nik chose the external
immutable-user merge boundary and intentionally removed formal GitHub
pull-request approval as evidence. That is not a reusable `APPROVED` review and
does not waive any technical gate. The readiness record must name the exact
head, prove the live administrator and external-user ruleset views, and record
terminal-clean samorev plus exact-head CI before `samo-agent` performs the only
permitted `main` update.

The repository Actions token cannot read the administration-scoped ruleset and
collaborator inventories needed by `scripts/check-branch-protection.sh`; putting
an administrator token in Actions would destroy the boundary it audits. The
external readiness operator therefore runs that live audit after every policy
or repository-settings change, immediately before publishing terminal samorev
success, immediately before merge, and immediately before creating a release
tag. Any unreadable or drifting audit blocks the operation.

The reviewed live-shape capture is
`fixtures/github-rulesets-live-2026-08-20.json`. The administrator `GET` view
preserves `actor_type: "User"`, immutable actor ID `280144521`, and
`bypass_mode: "always"` for both rulesets; the same two `GET` requests under the
`samo-agent` credential report `current_user_can_bypass: "always"`. The
administrator view reports `current_user_can_bypass: "never"`. The readiness
record must refresh and attach both live ruleset responses at the final exact
head; the committed capture is a regression fixture, not a substitute for that
pre-merge audit.

Immediately before approving a `production` deployment, Nik independently
proves that the lightweight release tag still targets the protected `main` tip;
workflow logs are not evidence:

```bash
tag="vX.Y.Z"
tag_sha="$(gh api "repos/NikolayS/gitzette/git/ref/tags/$tag" --jq .object.sha)"
main_sha="$(gh api repos/NikolayS/gitzette/commits/main --jq .sha)"
[[ "$tag_sha" == "$main_sha" ]]
```

An annotated tag is rejected because its ref targets a tag object rather than
the reviewed commit. A mismatch blocks approval and requires the same external
identity to delete the bad tag before retrying.

The live GitHub API shape was checked while PR #68 was open at head
`b55b9da15c142ed35ba9541a3b6652f0f3e631ec`: run `32266543608` reported event
`pull_request_target`, path `.github/workflows/samorev-gate.yml`, that exact PR
head in both `head_sha` and `pull_requests[0].head.sha`, base ref `main`, and
repository ID `1187899133` on both sides. This is the shape enforced by the
release script; synthetic tests fail closed for a non-main base, fork head,
wrong publisher target, or predated verdict on both CI and publisher evidence.

`samorev-gate` is fail-closed orchestration, not a second identity boundary. It
publishes pending immediately, retries transient API/malformed-response failures
three times, and waits up to 30 minutes. A later verdict needs a failed-job
rerun. Strict protection means updating the branch creates a new head and
requires another exact-head review cycle.

The ordinary `pull_request` CI workflow runs all PR-controlled code in the PR
cache scope with a read-only token, no repository secrets, and no persisted Git
credential. The `pull_request_target` publisher executes only protected-main
code. Until the one-shot recovery completes, the Cloudflare credentials are
repository-scoped and therefore potentially readable by any same-repository
workflow job. The bootstrap adds exactly one new intentional reader,
`.github/workflows/migrate-production-credentials.yml`, gated by the temporary
Nik-only, self-review-blocked, explicit-main-only `credential-migration`
environment, with `refs/heads/main` separately pinned by `authorize-export`.
The environment checker enumerates that sole `main` branch policy. It
does not narrow the existing repository-secret exposure, which is why #67 must
close the window immediately after verification. The canonical, mechanically
checkable #67 teardown list is step 8 of `docs/credential-migration.md`; this
document deliberately does not duplicate it. After its stored-value verification
and repository-copy deletion, deployment credentials are available only to the
protected `production` environment; tag-triggered deploys require that
environment's approval. Release tags must be pushed by immutable `samo-agent`
ID `280144521`, leaving Nik as the distinct sole production approver; a tag
pushed by Nik or repository Actions fails before deployment.
Failed Deploy runs must also be rerun by `samo-agent`; a rerun triggered by Nik
fails early because `scripts/check-release-tag-actor.sh` requires both
`github.actor_id` and the API-resolved `triggering_actor.id` to equal immutable
`samo-agent` ID `280144521`. Production `prevent_self_review` remains a separate
approval-time control.

The exporter writes only RSA-4096-OAEP ciphertext to a transient table in the
live Worker-bound application D1 database; no public Actions artifact is
created. That encryption is the stored value's only confidentiality boundary:
a Worker data-exposure path could leak ciphertext, but not plaintext, during
the bootstrap window. It is not an authenticity boundary: a D1 write path could
replace ciphertext. The operator therefore proves the row identity, timestamp,
and full ciphertext unchanged across two reads and binds the timestamp to the
export window with a 120-second cross-provider clock-skew tolerance. Those checks
protect against row replacement, duplication, and between-read mutation; the
account-ID equality pin plus exact-account Worker token probe is the control that
rejects substituted ciphertext containing attacker-selected credentials. The
committed Cloudflare account and D1 database IDs are deliberately non-confidential
identifiers used for exact-target binding. The account ID remains in the encrypted
pair only to preserve and verify the existing two-secret runtime interface; only
the API token depends on OAEP for confidentiality. Stored-value
verification uses a workflow-dispatch run pinned to the exact protected `main`
tip. GitHub records that immutable run SHA before the production approval wait,
and the workflow re-resolves `main` before and after approval. During the
bootstrap, production admits only reviewed `main` and `v*` refs, so
verification never widens policy and cancellation cannot strand broader access.
The verifier's green result is evidence only together with recorded
`REQUIRE_NO_REPOSITORY_CREDENTIALS=true` inventory output from the same
dispatch/approval window; GitHub's secret fallback makes the workflow result
insufficient by itself.
The independent scheduled guard always checks that same fixed policy. The
switch-residue job remains red while either switch is open, and the runbook
requires a green manual guard dispatch after each switch closes because GitHub
schedules are best-effort. A green cleanup run is not evidence that the bootstrap workflow or
environment has been removed; #67 verifies that separate teardown, removes the
temporary `main` branch policy, and restores the `v*`-only production baseline.
The D1
transfer table remains as a durable consumed-once marker until repository
credential copies are gone and stored-value verification succeeds.

Nik explicitly accepts one bootstrap residual risk: immutable user ID
`280144521` both publishes the external samorev verdict and performs the only
permitted `main` update, so compromise of that external credential would
collapse those two controls into one principal. Formal GitHub approval is not
reintroduced as ceremony. The compensating controls are that the credential is
absent from repository and environment secrets, repository Actions cannot use
it, exact-head CI and the protected-base publisher remain mandatory, the
administrator performs the readiness and live-policy audits, and Nik remains
the distinct non-bypassable production approver. The repository-scoped
Cloudflare-secret exposure is closed immediately after this bootstrap merges:
apply both environments first, export once, delete repository copies before
stored-value verification, and merge #67 immediately after verification.

Nik's role as the sole ordinary `production` approver is an accepted
single-person availability dependency; it is deliberately separate from the
`samo-agent` tag sender and cannot self-approve that sender's deployment. If Nik
is unavailable, the release waits unless a repository administrator opens an
incident/change record naming a specific substitute reviewer by immutable user
ID. Adding that reviewer requires a normal reviewed PR updating
`config/production-environment.json`, exact-head CI and terminal-clean samorev,
merge through the `samo-agent` boundary, then
`scripts/apply-production-environment.sh` and
`scripts/check-production-environment.sh` with their output attached to the
incident. The tag remains `samo-agent`-only and self-review remains blocked.
After the emergency deploy, remove the substitute through the same reviewed
code-and-live-policy sequence. Never edit the live reviewer set without first
changing the canonical config, and never disable `prevent_self_review` as
break-glass.

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

This gate protects releases, not compromised administrator credentials, installed
Apps, or secrets used by other event-triggered workflows. Actions holding
secrets must be commit-SHA pinned and must not check out or execute untrusted PR
code. The mention-driven Claude workflow is restricted to OWNER, MEMBER, or
COLLABORATOR-authored comments/reviews/issues, so arbitrary public commenters
cannot activate its OAuth credential.

## Requesting and approving a verdict

After every push or PR edit, wait until exact-head CI is green and
`samorev-gate` is pending. Resolve the current publisher run and job database
IDs, then run from a clean checkout of the PR head:

```bash
SAMOREV_HOME=/path/to/samorev
SAMO_TOKEN="$(gh auth token --user samo-agent)"
# Set false only for the credential bootstrap before installation; otherwise true.
: "${REQUIRE_PRODUCTION_CREDENTIALS:?set the credential-installation phase}"
REQUIRE_PRODUCTION_CREDENTIALS="$REQUIRE_PRODUCTION_CREDENTIALS" \
  bash scripts/check-reviewer-credential-isolation.sh
GH_TOKEN="$SAMO_TOKEN" SAMOREV_HOME="$SAMOREV_HOME" \
  bash scripts/run-samorev-review.sh NUMBER PUBLISHER_RUN_ID PUBLISHER_CHECK_RUN_ID
unset SAMO_TOKEN
```

The wrapper pins samorev commit `1397e976`, resolves the exact PR head, verifies
the protected-base publisher job, excludes only that exact pending self-check,
and publishes `samorev` pending plus a terminal success/failure/error under
immutable user ID `280144521`. Every status targets the exact publisher run;
the PR-time evaluator and release gate both reject another target URL.

Only after that exact-head review exits zero, CI is green, conversations are
resolved, and the readiness review confirms the same head SHA may the PR merge.
With the administrator's default `gh` credential, run
`bash scripts/check-release-review-evidence.sh HEAD_SHA` from the clean exact
reviewed head immediately before
merge; a green checks UI is not evidence. Then merge through `GH_TOKEN="$(gh
auth token --user samo-agent)" gh pr merge`, never through the administrator
credential. Never grant `samo-agent` admin access to make an
administration-scoped inventory call pass.
A GitHub `APPROVED` review is not required evidence; the reviewed branch policy
requires a pull request with zero approvals instead. For the bootstrap that
changes this policy, run `bash scripts/apply-branch-protection.sh` from the
terminal-clean exact reviewed head, rerun its audit, and only then merge that
same SHA. The apply creates and verifies the external-user update ruleset and the
immutable-user release-tag ruleset before it
changes formal approval requirements to zero/false, and keeps admin enforcement,
required technical statuses, required conversations, and force-push/deletion denial.

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
an exact-head status and a fresh successful protected-base publisher run. The current review has
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
report before readiness review.

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

`config/main-branch-protection.json` records the reviewed classic-branch policy,
the active `main-samo-only-updates` ruleset, and the active
`release-tags-samo-only` tag ruleset.
`scripts/check-branch-protection.sh` exact-matches it against live
classic branch protection, Actions workflow permissions, and full repository or
inherited ruleset details. Its approval count is zero and must not be restored
or awaited. Both rulesets' only bypass actor is immutable user ID `280144521`;
no administrator, Integration, or GitHub Actions actor may update `main` or
create, update, or delete `v*`. The apply script does not delete rulesets; unexpected
rulesets must be reconciled deliberately.

For the bootstrap PR, require its own exact-head CI, a clean samorev verdict,
and readiness review. Do not wait for a GitHub approval and do not
reapply the legacy approval rule. Audit production policy before migration:

```bash
bash scripts/check-branch-protection.sh
samo_token="$(gh auth token --user samo-agent)"
GH_TOKEN="$samo_token" bash scripts/check-branch-protection-nonadmin.sh
# Bootstrap only; post-migration readiness uses REQUIRE_PRODUCTION_CREDENTIALS=true.
bash scripts/check-reviewer-credential-isolation.sh
bash scripts/check-production-environment.sh
```

Reading or changing live protection requires repository-administration access.
