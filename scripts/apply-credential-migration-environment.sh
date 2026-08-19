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

live="$(gh api --paginate --slurp "repos/$repository/environments/$environment/deployment-branch-policies?per_page=100" | jq -c 'map(.branch_policies) | add')"
expected_policies="$(jq -c '.branch_policies' "$policy")"
while IFS= read -r policy_id; do
  gh api --method DELETE "repos/$repository/environments/$environment/deployment-branch-policies/$policy_id" --silent
done < <(jq -r --argjson expected "$expected_policies" '.[] | select(. as $live | any($expected[]; .name == $live.name and .type == $live.type) | not) | .id' <<<"$live")

while IFS=$'\t' read -r name type; do
  if ! jq -e --arg name "$name" --arg type "$type" 'any(.[]; .name == $name and .type == $type)' <<<"$live" >/dev/null; then
    gh api --method POST "repos/$repository/environments/$environment/deployment-branch-policies" \
      -f name="$name" -f type="$type" --silent
  fi
done < <(jq -r '.branch_policies[] | [.name,.type] | @tsv' "$policy")

bash "$root/scripts/check-credential-migration-environment.sh"
