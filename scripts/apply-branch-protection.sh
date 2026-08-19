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

# Install the non-forgeable update boundary before reducing formal approvals.
# Only immutable external user ID 280144521 can update main; GitHub Actions and
# repository administrators are not bypass actors even if contexts are forged.
if [[ "$(jq '.repository_rulesets | length' "$policy")" -ne 2 ]]; then
  echo "branch policy must define exactly the main and release-tag rulesets" >&2
  exit 1
fi
jq '{allow_auto_merge}' "$policy" | gh api --method PATCH "repos/$repository" --input - --silent
ruleset_summaries="$(gh api --paginate --slurp "repos/$repository/rulesets?includes_parents=false&per_page=100" | jq -c 'add')"
while IFS= read -r ruleset_payload; do
  ruleset_name="$(jq -r .name <<<"$ruleset_payload")"
  matching_ids="$(jq -r --arg name "$ruleset_name" '.[] | select(.name == $name) | .id' <<<"$ruleset_summaries")"
  if [[ "$(wc -w <<<"$matching_ids")" -gt 1 ]]; then
    echo "multiple repository rulesets are named $ruleset_name" >&2
    exit 1
  fi
  if [[ -n "$matching_ids" ]]; then
    ruleset_endpoint="repos/$repository/rulesets/$matching_ids"
    ruleset_method=PUT
  else
    ruleset_endpoint="repos/$repository/rulesets"
    ruleset_method=POST
  fi
  ruleset_mutation="$(jq '{name,target,enforcement,bypass_actors,conditions,rules}' <<<"$ruleset_payload" |
    gh api --method "$ruleset_method" "$ruleset_endpoint" --input -)"
  ruleset_id="$(jq -er .id <<<"$ruleset_mutation")"
  live_ruleset="$(gh api "repos/$repository/rulesets/$ruleset_id")"
  if [[ "$(jq -r .current_user_can_bypass <<<"$live_ruleset")" != never ]]; then
    echo "the applying administrator has an unexpected bypass for $ruleset_name" >&2
    exit 1
  fi
  normalized_ruleset="$(jq -Sc '{name,target,enforcement,bypass_actors,conditions,rules} |
    .bypass_actors |= sort_by(.actor_type, .actor_id) |
    .rules |= map(
      if .type == "update" and (has("parameters") | not) then
        .parameters = {update_allows_fetch_and_merge:false}
      else . end
    ) | .rules |= sort_by(.type)' <<<"$live_ruleset")"
  expected_ruleset="$(jq -Sc '{name,target,enforcement,bypass_actors,conditions,rules} |
    .bypass_actors |= sort_by(.actor_type, .actor_id) | .rules |= sort_by(.type)' <<<"$ruleset_payload")"
  if [[ "$normalized_ruleset" != "$expected_ruleset" ]]; then
    echo "$ruleset_name did not apply exactly" >&2
    exit 1
  fi
done < <(jq -c '.repository_rulesets[]' "$policy")

# Prove the effective boundary too: the exact non-admin samo-agent identity must
# be the bypass actor for both protected main updates and release tags.
samo_token="$(env -u GH_TOKEN gh auth token --user samo-agent)"
GH_TOKEN="$samo_token" GITHUB_REPOSITORY="$repository" \
  "$root/scripts/check-branch-protection-nonadmin.sh"

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

trap - EXIT
"$root/scripts/check-branch-protection.sh"
