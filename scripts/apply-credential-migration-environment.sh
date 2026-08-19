#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "apply-credential-migration-environment.sh must be executed by path, not sourced or piped to Bash" >&2
  if [[ -n "${BASH_SOURCE[0]:-}" ]]; then return 1; fi
  exit 1
fi
set -euo pipefail

root="$(CDPATH='' cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null && pwd)"
repository="${GITHUB_REPOSITORY:-$(gh repo view "$(git -C "$root" remote get-url origin)" --json nameWithOwner --jq .nameWithOwner)}"
policy="$root/config/credential-migration-environment.json"
environment=credential-migration

jq '{wait_timer,can_admins_bypass,prevent_self_review,reviewers:[.reviewers[]|{type,id}],deployment_branch_policy}' "$policy" |
  gh api --method PUT "repos/$repository/environments/$environment" --input - --silent

live="$(gh api --paginate --slurp "repos/$repository/environments/$environment/deployment-branch-policies?per_page=100" | jq -c 'map(.branch_policies) | add // []')"
expected_policies="$(jq -c '.branch_policies' "$policy")"
stale_policy_ids="$(jq -r --argjson expected "$expected_policies" '
  group_by([.name,.type])[] as $group |
  if any($expected[]; .name == $group[0].name and .type == $group[0].type)
  then $group[1:][]?.id
  else $group[].id
  end
' <<<"$live")"
while IFS= read -r policy_id; do
  [[ -n "$policy_id" ]] || continue
  gh api --method DELETE "repos/$repository/environments/$environment/deployment-branch-policies/$policy_id" --silent
done <<<"$stale_policy_ids"

live="$(gh api --paginate --slurp "repos/$repository/environments/$environment/deployment-branch-policies?per_page=100" | jq -c 'map(.branch_policies) | add // []')"
desired_policies="$(jq -r '[.branch_policies[] | [.name,.type] | @tsv] | .[]' "$policy")"
while IFS=$'\t' read -r name type; do
  [[ -n "$name" && -n "$type" ]] || continue
  if ! jq -e --arg name "$name" --arg type "$type" 'any(.[]; .name == $name and .type == $type)' <<<"$live" >/dev/null; then
    gh api --method POST "repos/$repository/environments/$environment/deployment-branch-policies" \
      -f name="$name" -f type="$type" --silent
  fi
done <<<"$desired_policies"

bash "$root/scripts/check-credential-migration-environment.sh"
