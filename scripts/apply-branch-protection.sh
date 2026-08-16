#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repository="${GITHUB_REPOSITORY:-$(gh repo view "$(git -C "$root" remote get-url origin)" --json nameWithOwner --jq .nameWithOwner)}"
policy="$root/config/main-branch-protection.json"
owner_type="$(gh api "repos/$repository" --jq .owner.type)"

audit_partial_apply() {
  rc=$?
  if [[ "$rc" -ne 0 ]]; then
    echo "Branch-protection apply failed; auditing the possibly partial live policy" >&2
    "$root/scripts/check-branch-protection.sh" || true
  fi
  exit "$rc"
}
trap audit_partial_apply EXIT

jq '.actions_workflow_permissions' "$policy" | gh api --method PUT \
  "repos/$repository/actions/permissions/workflow" --input - --silent

# The full endpoint establishes all classic controls. Its legacy contexts field
# is immediately replaced by the app-bound checks array below.
jq --arg owner_type "$owner_type" '{
  required_status_checks: {strict: .required_status_checks.strict, contexts: [.required_status_checks.checks[].context]},
  enforce_admins,
  required_pull_request_reviews,
  restrictions,
  required_linear_history,
  allow_force_pushes,
  allow_deletions,
  required_conversation_resolution,
  lock_branch,
  block_creations
} | if $owner_type == "Organization" then . else
  .required_pull_request_reviews |= del(.dismissal_restrictions, .bypass_pull_request_allowances)
  end
' "$policy" | gh api --method PUT "repos/$repository/branches/main/protection" --input - --silent

jq '.required_status_checks' "$policy" | gh api --method PATCH \
  "repos/$repository/branches/main/protection/required_status_checks" --input - --silent

if jq -e '.required_signatures' "$policy" >/dev/null; then
  gh api --method POST "repos/$repository/branches/main/protection/required_signatures" --silent
else
  gh api --method DELETE "repos/$repository/branches/main/protection/required_signatures" --silent
fi

"$root/scripts/check-branch-protection.sh"
trap - EXIT
