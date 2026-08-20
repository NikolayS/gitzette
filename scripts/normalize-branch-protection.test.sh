#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workflow_permissions='{"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}'
live_ruleset_fixture="$root/fixtures/github-rulesets-live-2026-08-20.json"
rulesets="$(jq -c .admin_rulesets "$live_ruleset_fixture")"
[[ "$(jq -r '[.admin_rulesets[].bypass_actors[] | select(.actor_id == 280144521 and .actor_type == "User" and .bypass_mode == "always")] | length' "$live_ruleset_fixture")" == 2 ]] || {
  echo "captured admin rulesets did not preserve the immutable User bypass actor" >&2
  exit 1
}
[[ "$(jq -r '[.external_rulesets[] | select(.bypass_actors == null and .current_user_can_bypass == "always")] | length' "$live_ruleset_fixture")" == 2 ]] || {
  echo "captured external rulesets did not preserve the samo-agent bypass view" >&2
  exit 1
}
protection='{
  "required_status_checks":{"strict":true,"checks":[{"context":"typecheck","app_id":15368},{"context":"samorev-gate","app_id":15368},{"context":"samorev","app_id":null},{"context":"policy-api-readability","app_id":15368}]},
  "enforce_admins":{"enabled":true},
  "required_pull_request_reviews":{"dismiss_stale_reviews":false,"require_code_owner_reviews":false,"required_approving_review_count":0,"require_last_push_approval":false},
  "required_conversation_resolution":{"enabled":true},
  "allow_force_pushes":{"enabled":false},"allow_deletions":{"enabled":false},
  "required_linear_history":{"enabled":false},"required_signatures":{"enabled":false},
  "lock_branch":{"enabled":false},"block_creations":{"enabled":false}
}'

actual="$(jq -nSc --argjson protection "$protection" --argjson workflow_permissions "$workflow_permissions" --argjson rulesets "$rulesets" -f "$root/scripts/normalize-branch-protection.jq")"
expected="$(jq -Sc 'del(.audit_command,.allow_auto_merge) |
  .required_status_checks.checks |= sort_by(.context) |
  .repository_rulesets |= map(.bypass_actors |= sort_by(.actor_type,.actor_id) | .rules |= sort_by(.type)) |
  .repository_rulesets |= sort_by(.name)' "$root/config/main-branch-protection.json")"
[[ "$actual" == "$expected" ]] || { echo "compliant protection fixture did not normalize to policy" >&2; exit 1; }

reordered_rulesets="$(jq -c 'reverse | map(.rules |= reverse)' <<<"$rulesets")"
actual="$(jq -nSc --argjson protection "$protection" --argjson workflow_permissions "$workflow_permissions" --argjson rulesets "$reordered_rulesets" -f "$root/scripts/normalize-branch-protection.jq")"
[[ "$actual" == "$expected" ]] || { echo "equivalent reordered rulesets did not normalize to policy" >&2; exit 1; }

api_normalized_rulesets="$(jq -c 'map(.rules |= map(if .type == "update" then del(.parameters) else . end))' <<<"$rulesets")"
actual="$(jq -nSc --argjson protection "$protection" --argjson workflow_permissions "$workflow_permissions" --argjson rulesets "$api_normalized_rulesets" -f "$root/scripts/normalize-branch-protection.jq")"
[[ "$actual" == "$expected" ]] || { echo "GitHub-defaulted update rules did not normalize to policy" >&2; exit 1; }

mutated="$(jq -c '.enforce_admins.enabled=false' <<<"$protection")"
actual="$(jq -nSc --argjson protection "$mutated" --argjson workflow_permissions "$workflow_permissions" --argjson rulesets "$rulesets" -f "$root/scripts/normalize-branch-protection.jq")"
[[ "$actual" != "$expected" ]] || { echo "enforce_admins drift was not detected" >&2; exit 1; }

assert_drift() {
  name="$1"
  changed_protection="$2"
  changed_rulesets="${3:-$rulesets}"
  changed_workflow_permissions="${4:-$workflow_permissions}"
  normalized="$(jq -nSc --argjson protection "$changed_protection" --argjson workflow_permissions "$changed_workflow_permissions" --argjson rulesets "$changed_rulesets" -f "$root/scripts/normalize-branch-protection.jq")"
  [[ "$normalized" != "$expected" ]] || { echo "$name drift was not detected" >&2; exit 1; }
}

assert_drift bypass "$(jq -c '.required_pull_request_reviews.bypass_pull_request_allowances={users:[{login:"attacker"}],teams:[],apps:[]}' <<<"$protection")"
assert_drift dismissal "$(jq -c '.required_pull_request_reviews.dismissal_restrictions={users:[{login:"attacker"}],teams:[]}' <<<"$protection")"
assert_drift pull-request-requirement-removed "$(jq -c 'del(.required_pull_request_reviews)' <<<"$protection")"
assert_drift restrictions "$(jq -c '.restrictions={users:[{login:"attacker"}],teams:[],apps:[]}' <<<"$protection")"
assert_drift strict-disabled "$(jq -c '.required_status_checks.strict=false' <<<"$protection")"
assert_drift required-check-removed "$(jq -c '.required_status_checks.checks |= map(select(.context != "samorev"))' <<<"$protection")"
assert_drift required-check-app-unbound "$(jq -c '(.required_status_checks.checks[] | select(.context == "typecheck")).app_id=null' <<<"$protection")"
assert_drift workflow-write "$protection" "$rulesets" \
  "$(jq -c '.default_workflow_permissions="write"' <<<"$workflow_permissions")"
assert_drift missing-ruleset "$protection" '[]'
assert_drift actions-bypass "$protection" "$(jq -c '.[0].bypass_actors += [{actor_id:15368,actor_type:"Integration",bypass_mode:"always"}]' <<<"$rulesets")"
assert_drift missing-tag-ruleset "$protection" "$(jq -c 'del(.[1])' <<<"$rulesets")"
assert_drift tag-user-widened "$protection" "$(jq -c '.[1].bypass_actors[0].actor_id=1' <<<"$rulesets")"
assert_drift ruleset-disabled "$protection" "$(jq -c '.[0].enforcement="disabled"' <<<"$rulesets")"
assert_drift update-rule-removed "$protection" "$(jq -c '.[0].rules=[]' <<<"$rulesets")"
assert_drift update-rule-null-parameters "$protection" "$(jq -c '.[0].rules |= map(if .type == "update" then .parameters=null else . end)' <<<"$rulesets")"
assert_drift main-deletion-rule-removed "$protection" "$(jq -c '.[0].rules |= map(select(.type != "deletion"))' <<<"$rulesets")"
assert_drift main-creation-rule-removed "$protection" "$(jq -c '.[0].rules |= map(select(.type != "creation"))' <<<"$rulesets")"
assert_drift ref-widened "$protection" "$(jq -c '.[0].conditions.ref_name.include=["~ALL"]' <<<"$rulesets")"

stub_dir="$(mktemp -d)"
trap 'rm -rf "$stub_dir"' EXIT
cat >"$stub_dir/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "$*" == *'repos/example/gitzette --jq .allow_auto_merge'* ]] || exit 91
printf 'true\n'
EOF
chmod +x "$stub_dir/gh"
if GITHUB_REPOSITORY=example/gitzette PATH="$stub_dir:$PATH" \
  bash "$root/scripts/check-branch-protection.sh" >"$stub_dir/out" 2>"$stub_dir/err"; then
  echo "allow_auto_merge drift was not rejected" >&2
  exit 1
fi
grep -q 'repository allow_auto_merge differs' "$stub_dir/err" || {
  echo "allow_auto_merge drift did not produce the expected diagnostic" >&2
  exit 1
}

echo "branch-protection normalization and security-field tests passed"
