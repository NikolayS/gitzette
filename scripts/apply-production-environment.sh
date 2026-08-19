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

error_file="$(mktemp)"
trap 'rm -f "$error_file"' EXIT
if live_environment="$(gh api "repos/$repository/environments/production" 2>"$error_file")"; then
  if [[ "$(jq -r .can_admins_bypass <<<"$live_environment")" != false ]]; then
    echo 'disable "Allow administrators to bypass configured protection rules" for environment production in Settings -> Environments before applying' >&2
    exit 1
  fi
  if [[ "$(jq -r .deployment_branch_policy.custom_branch_policies <<<"$live_environment")" == true ]]; then
    live="$(gh api --paginate --slurp "repos/$repository/environments/production/deployment-branch-policies?per_page=100" | jq -c 'map(.branch_policies) | add // []')"
  else
    live='[]'
  fi
elif grep -Eq 'HTTP 404([^0-9]|$)' "$error_file"; then
  live='[]'
else
  echo "unable to inspect production environment before apply:" >&2
  sed 's/^/  /' "$error_file" >&2
  exit 3
fi

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
  gh api --method DELETE "repos/$repository/environments/production/deployment-branch-policies/$policy_id" --silent
done <<<"$stale_policy_ids"

# GitHub exposes can_admins_bypass in GET responses but does not accept it in
# this PUT body. The preflight above refuses a bypassable existing environment;
# the checker below proves that PUT preserved the disabled setting.
jq '{wait_timer,prevent_self_review,reviewers:[.reviewers[]|{type,id}],deployment_branch_policy}' "$policy" |
  gh api --method PUT "repos/$repository/environments/production" --input - --silent

if ! post_apply_environment="$(gh api "repos/$repository/environments/production" 2>"$error_file")"; then
  echo "unable to re-read production environment after apply:" >&2
  sed 's/^/  /' "$error_file" >&2
  exit 3
fi
if [[ "$(jq -r .can_admins_bypass <<<"$post_apply_environment")" != false ]]; then
  echo 'disable "Allow administrators to bypass configured protection rules" for environment production in Settings -> Environments, then re-run' >&2
  exit 1
fi

if [[ "$(jq -r .deployment_branch_policy.custom_branch_policies "$policy")" == true ]]; then
  live="$(gh api --paginate --slurp "repos/$repository/environments/production/deployment-branch-policies?per_page=100" | jq -c 'map(.branch_policies) | add // []')"
  desired_policies="$(jq -r '[.branch_policies[] | [.name,.type] | @tsv] | .[]' "$policy")"
  while IFS=$'\t' read -r name type; do
    [[ -n "$name" && -n "$type" ]] || continue
    if ! jq -e --arg name "$name" --arg type "$type" 'any(.[]; .name == $name and .type == $type)' <<<"$live" >/dev/null; then
      gh api --method POST "repos/$repository/environments/production/deployment-branch-policies" \
        -f name="$name" -f type="$type" --silent
    fi
  done <<<"$desired_policies"
fi

"$root/scripts/check-production-environment.sh" "$mode"
