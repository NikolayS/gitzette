#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
remote="$(git -C "$root" remote get-url origin)"
repository="${GITHUB_REPOSITORY:-$(gh repo view "$remote" --json nameWithOwner --jq .nameWithOwner)}"
expected="$(jq -Sc 'del(.audit_command) | .required_status_checks.checks |= sort_by(.context)' "$root/config/main-branch-protection.json")"
protection="$(gh api "repos/$repository/branches/main/protection")"
rulesets="$(gh api "repos/$repository/rules/branches/main")"
actual="$(jq -nSc --argjson protection "$protection" --argjson rulesets "$rulesets" '$protection | {required_status_checks:{strict:.required_status_checks.strict,checks:((.required_status_checks.checks // [])|sort_by(.context))},enforce_admins:.enforce_admins.enabled,required_pull_request_reviews:{dismiss_stale_reviews:.required_pull_request_reviews.dismiss_stale_reviews,require_code_owner_reviews:.required_pull_request_reviews.require_code_owner_reviews,required_approving_review_count:.required_pull_request_reviews.required_approving_review_count,require_last_push_approval:.required_pull_request_reviews.require_last_push_approval},required_conversation_resolution:.required_conversation_resolution.enabled,allow_force_pushes:.allow_force_pushes.enabled,allow_deletions:.allow_deletions.enabled,required_linear_history:.required_linear_history.enabled,required_signatures:.required_signatures.enabled,lock_branch:.lock_branch.enabled,block_creations:.block_creations.enabled,restrictions:(.restrictions // null),effective_branch_rulesets:$rulesets}')"

if [[ "$actual" != "$expected" ]]; then
  echo "main branch protection differs from config/main-branch-protection.json" >&2
  echo "expected: $expected" >&2
  echo "actual:   $actual" >&2
  exit 1
fi

echo "Branch protection OK: base-controlled gate, exact-head verdict, CI, and an independent fresh approval are required for admins"
