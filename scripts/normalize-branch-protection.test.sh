#!/usr/bin/env bash
set -euo pipefail

root="$(CDPATH='' cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null && pwd)"
workflow_permissions='{"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}'
rulesets='[]'
protection='{
  "required_status_checks":{"strict":true,"checks":[{"context":"typecheck","app_id":15368},{"context":"samorev-gate","app_id":15368},{"context":"samorev","app_id":null}]},
  "enforce_admins":{"enabled":true},
  "required_pull_request_reviews":{"dismiss_stale_reviews":true,"require_code_owner_reviews":false,"required_approving_review_count":0,"require_last_push_approval":false},
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

assert_drift() {
  name="$1"
  changed_protection="$2"
  changed_rulesets="${3:-[]}"
  normalized="$(jq -nSc --argjson protection "$changed_protection" --argjson workflow_permissions "$workflow_permissions" --argjson rulesets "$changed_rulesets" -f "$root/scripts/normalize-branch-protection.jq")"
  [[ "$normalized" != "$expected" ]] || { echo "$name drift was not detected" >&2; exit 1; }
}

assert_drift status-strict "$(jq -c '.required_status_checks.strict=false' <<<"$protection")"
assert_drift missing-samorev "$(jq -c '.required_status_checks.checks |= map(select(.context != "samorev"))' <<<"$protection")"
assert_drift samorev-app "$(jq -c '(.required_status_checks.checks[] | select(.context == "samorev")).app_id=15368' <<<"$protection")"
assert_drift gate-app "$(jq -c '(.required_status_checks.checks[] | select(.context == "samorev-gate")).app_id=null' <<<"$protection")"
assert_drift typecheck-app "$(jq -c '(.required_status_checks.checks[] | select(.context == "typecheck")).app_id=null' <<<"$protection")"

bypass="$(jq -c '.required_pull_request_reviews.bypass_pull_request_allowances={users:[{login:"attacker"}],teams:[],apps:[]}' <<<"$protection")"
normalized="$(jq -nSc --argjson protection "$bypass" --argjson workflow_permissions "$workflow_permissions" --argjson rulesets "$rulesets" -f "$root/scripts/normalize-branch-protection.jq")"
[[ "$(jq -c '.required_pull_request_reviews.bypass_pull_request_allowances.users' <<<"$normalized")" == '["attacker"]' ]] || { echo "bypass allowance shape was hidden" >&2; exit 1; }
assert_drift bypass "$bypass"

dismissal="$(jq -c '.required_pull_request_reviews.dismissal_restrictions={users:[{login:"attacker"}],teams:[]}' <<<"$protection")"
normalized="$(jq -nSc --argjson protection "$dismissal" --argjson workflow_permissions "$workflow_permissions" --argjson rulesets "$rulesets" -f "$root/scripts/normalize-branch-protection.jq")"
[[ "$(jq -c '.required_pull_request_reviews.dismissal_restrictions.users' <<<"$normalized")" == '["attacker"]' ]] || { echo "dismissal restriction shape was hidden" >&2; exit 1; }
assert_drift dismissal "$dismissal"

approval="$(jq -c '.required_pull_request_reviews.required_approving_review_count=1 | .required_pull_request_reviews.require_last_push_approval=true' <<<"$protection")"
normalized="$(jq -nSc --argjson protection "$approval" --argjson workflow_permissions "$workflow_permissions" --argjson rulesets "$rulesets" -f "$root/scripts/normalize-branch-protection.jq")"
[[ "$(jq -r '.required_pull_request_reviews.required_approving_review_count' <<<"$normalized")" == 1 ]] || { echo "approval count was hidden" >&2; exit 1; }
[[ "$(jq -r '.required_pull_request_reviews.require_last_push_approval' <<<"$normalized")" == true ]] || { echo "last-push approval was hidden" >&2; exit 1; }
assert_drift approval "$approval"

no_pr_requirement="$(jq -c 'del(.required_pull_request_reviews)' <<<"$protection")"
normalized="$(jq -nSc --argjson protection "$no_pr_requirement" --argjson workflow_permissions "$workflow_permissions" --argjson rulesets "$rulesets" -f "$root/scripts/normalize-branch-protection.jq")"
[[ "$(jq -c '.required_pull_request_reviews' <<<"$normalized")" == null ]] || { echo "missing PR requirement did not normalize to null" >&2; exit 1; }
assert_drift no_pr_requirement "$no_pr_requirement"
assert_drift restrictions "$(jq -c '.restrictions={users:[{login:"attacker"}],teams:[],apps:[]}' <<<"$protection")"
assert_drift ruleset "$protection" '[{"name":"bypass","target":"branch","enforcement":"active","bypass_actors":[{"actor_type":"RepositoryRole","actor_id":5,"bypass_mode":"always"}],"conditions":{},"rules":[]}]'

echo "branch-protection normalization and security-field tests passed"
