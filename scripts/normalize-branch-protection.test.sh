#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workflow_permissions='{"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}'
rulesets='[]'
protection='{
  "required_status_checks":{"strict":true,"checks":[{"context":"typecheck","app_id":15368},{"context":"samorev-gate","app_id":15368},{"context":"samorev","app_id":null}]},
  "enforce_admins":{"enabled":true},
  "required_pull_request_reviews":{"dismiss_stale_reviews":true,"require_code_owner_reviews":true,"required_approving_review_count":1,"require_last_push_approval":true},
  "required_conversation_resolution":{"enabled":true},
  "allow_force_pushes":{"enabled":false},"allow_deletions":{"enabled":false},
  "required_linear_history":{"enabled":false},"required_signatures":{"enabled":false},
  "lock_branch":{"enabled":false},"block_creations":{"enabled":false}
}'

actual="$(jq -nSc --argjson protection "$protection" --argjson workflow_permissions "$workflow_permissions" --argjson rulesets "$rulesets" -f "$root/scripts/normalize-branch-protection.jq")"
expected="$(jq -Sc 'del(.audit_command) | .required_status_checks.checks |= sort_by(.context)' "$root/config/main-branch-protection.json")"
[[ "$actual" == "$expected" ]] || { echo "compliant protection fixture did not normalize to policy" >&2; exit 1; }

mutated="$(jq -c '.enforce_admins.enabled=false' <<<"$protection")"
actual="$(jq -nSc --argjson protection "$mutated" --argjson workflow_permissions "$workflow_permissions" --argjson rulesets "$rulesets" -f "$root/scripts/normalize-branch-protection.jq")"
[[ "$actual" != "$expected" ]] || { echo "enforce_admins drift was not detected" >&2; exit 1; }

echo "branch-protection normalization tests passed"
