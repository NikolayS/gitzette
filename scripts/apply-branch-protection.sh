#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
remote="$(git -C "$root" remote get-url origin)"
repository="${GITHUB_REPOSITORY:-$(gh repo view "$remote" --json nameWithOwner --jq .nameWithOwner)}"
policy="$root/config/main-branch-protection.json"

# The full endpoint establishes all classic controls. Its legacy contexts field
# is immediately replaced by the app-bound checks array below.
jq '{
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
}' "$policy" | gh api --method PUT "repos/$repository/branches/main/protection" --input - --silent

jq '.required_status_checks' "$policy" | gh api --method PATCH \
  "repos/$repository/branches/main/protection/required_status_checks" --input - --silent

if jq -e '.required_signatures' "$policy" >/dev/null; then
  gh api --method POST "repos/$repository/branches/main/protection/required_signatures" --silent
else
  gh api --method DELETE "repos/$repository/branches/main/protection/required_signatures" --silent
fi

"$root/scripts/check-branch-protection.sh"
