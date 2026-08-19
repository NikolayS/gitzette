#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workflow_permissions='{"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}'
rulesets='[]'
protection='{
  "required_status_checks":{"strict":true,"checks":[{"context":"typecheck","app_id":15368},{"context":"samorev-gate","app_id":15368},{"context":"samorev","app_id":null}]},
  "enforce_admins":{"enabled":true},
  "required_pull_request_reviews":null,
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

assert_drift bypass "$(jq -c '.required_pull_request_reviews.bypass_pull_request_allowances={users:[{login:"attacker"}],teams:[],apps:[]}' <<<"$protection")"
assert_drift dismissal "$(jq -c '.required_pull_request_reviews.dismissal_restrictions={users:[{login:"attacker"}],teams:[]}' <<<"$protection")"
assert_drift approval "$(jq -c '.required_pull_request_reviews={required_approving_review_count:1,require_code_owner_reviews:true}' <<<"$protection")"
assert_drift restrictions "$(jq -c '.restrictions={users:[{login:"attacker"}],teams:[],apps:[]}' <<<"$protection")"
assert_drift ruleset "$protection" '[{"name":"bypass","target":"branch","enforcement":"active","bypass_actors":[{"actor_type":"RepositoryRole","actor_id":5,"bypass_mode":"always"}],"conditions":{},"rules":[]}]'

echo "branch-protection normalization and security-field tests passed"
