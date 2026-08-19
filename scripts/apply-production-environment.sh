#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -n "${GITHUB_REPOSITORY:-}" ]]; then
  repository="$GITHUB_REPOSITORY"
else
  repository="$(gh repo view "$(git -C "$root" remote get-url origin)" --json nameWithOwner --jq .nameWithOwner)"
fi
created_environment=false
if [[ "$#" -ne 0 ]]; then
  echo "usage: $0" >&2
  exit 2
fi
policy="$root/config/production-environment.json"

error_file="$(mktemp)"
trap 'rm -f "$error_file"' EXIT
set +e
live_environment="$("$root/scripts/get-github-environment.sh" "$repository" production 2>"$error_file")"
environment_status=$?
set -e
if [[ "$environment_status" -eq 0 ]]; then
  if [[ "$(jq -r .can_admins_bypass <<<"$live_environment")" != false ]]; then
    echo 'disable "Allow administrators to bypass configured protection rules" for environment production in Settings -> Environments before applying' >&2
    exit 1
  fi
elif [[ "$environment_status" -eq 4 ]]; then
  created_environment=true
else
  echo "unable to inspect production environment before apply:" >&2
  sed 's/^/  /' "$error_file" >&2
  exit 3
fi

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
  if [[ "$created_environment" == true ]]; then
    echo 'production was newly created with admin bypass enabled; disable "Allow administrators to bypass configured protection rules" in Settings -> Environments, then re-run before any deployment' >&2
  else
    echo 'disable "Allow administrators to bypass configured protection rules" for environment production in Settings -> Environments, then re-run' >&2
  fi
  exit 1
fi

live="$(gh api --paginate --slurp "repos/$repository/environments/production/deployment-branch-policies?per_page=100" | jq -c 'map(.branch_policies) | add // []')"
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

"$root/scripts/check-production-environment.sh"
