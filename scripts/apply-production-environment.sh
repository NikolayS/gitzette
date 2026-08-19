#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -n "${GITHUB_REPOSITORY:-}" ]]; then
  repository="$GITHUB_REPOSITORY"
else
  repository="$(gh repo view "$(git -C "$root" remote get-url origin)" --json nameWithOwner --jq .nameWithOwner)"
fi
mode="${1:-default}"
case "$mode" in
  default) policy="$root/config/production-environment.json" ;;
  migration) policy="$root/config/production-environment-migration.json" ;;
  *) echo "usage: $0 [default|migration]" >&2; exit 2 ;;
esac

jq '{wait_timer,can_admins_bypass,prevent_self_review,reviewers:[.reviewers[]|{type,id}],deployment_branch_policy}' "$policy" |
  gh api --method PUT "repos/$repository/environments/production" --input - --silent

live="$(gh api --paginate --slurp "repos/$repository/environments/production/deployment-branch-policies?per_page=100" | jq -c 'map(.branch_policies) | add // []')"
expected_policies="$(jq -c '.branch_policies' "$policy")"
while IFS= read -r policy_id; do
  gh api --method DELETE "repos/$repository/environments/production/deployment-branch-policies/$policy_id" --silent
done < <(jq -r --argjson expected "$expected_policies" '
  group_by([.name,.type])[] as $group |
  if any($expected[]; .name == $group[0].name and .type == $group[0].type)
  then $group[1:][]?.id
  else $group[].id
  end
' <<<"$live")

live="$(gh api --paginate --slurp "repos/$repository/environments/production/deployment-branch-policies?per_page=100" | jq -c 'map(.branch_policies) | add // []')"

while IFS=$'\t' read -r name type; do
  if ! jq -e --arg name "$name" --arg type "$type" 'any(.[]; .name == $name and .type == $type)' <<<"$live" >/dev/null; then
    gh api --method POST "repos/$repository/environments/production/deployment-branch-policies" \
      -f name="$name" -f type="$type" --silent
  fi
done < <(jq -r '.branch_policies[] | [.name,.type] | @tsv' "$policy")

"$root/scripts/check-production-environment.sh" "$mode"
