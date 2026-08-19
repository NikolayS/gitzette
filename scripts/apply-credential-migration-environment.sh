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
created_environment=false

error_file="$(mktemp)"
trap 'rm -f "$error_file"' EXIT
set +e
live_environment="$("$root/scripts/get-github-environment.sh" "$repository" "$environment" 2>"$error_file")"
environment_status=$?
set -e
if [[ "$environment_status" -eq 0 ]]; then
  if [[ "$(jq -r .can_admins_bypass <<<"$live_environment")" != false ]]; then
    echo 'disable "Allow administrators to bypass configured protection rules" for environment credential-migration in Settings -> Environments before applying' >&2
    exit 1
  fi
  if [[ "$(jq -r .deployment_branch_policy.custom_branch_policies <<<"$live_environment")" == true ]]; then
    live="$(gh api --paginate --slurp "repos/$repository/environments/$environment/deployment-branch-policies?per_page=100" | jq -c 'map(.branch_policies) | add // []')"
  else
    live='[]'
  fi
elif [[ "$environment_status" -eq 4 ]]; then
  created_environment=true
  live='[]'
else
  echo "unable to inspect credential-migration environment before apply:" >&2
  sed 's/^/  /' "$error_file" >&2
  exit 1
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
  gh api --method DELETE "repos/$repository/environments/$environment/deployment-branch-policies/$policy_id" --silent
done <<<"$stale_policy_ids"

# GitHub exposes can_admins_bypass in GET responses but does not accept it in
# this PUT body. The checker below enforces the operator-controlled UI setting.
jq '{wait_timer,prevent_self_review,reviewers:[.reviewers[]|{type,id}],deployment_branch_policy}' "$policy" |
  gh api --method PUT "repos/$repository/environments/$environment" --input - --silent

if ! post_apply_environment="$(gh api "repos/$repository/environments/$environment" 2>"$error_file")"; then
  echo "unable to re-read credential-migration environment after apply:" >&2
  sed 's/^/  /' "$error_file" >&2
  exit 3
fi
if [[ "$(jq -r .can_admins_bypass <<<"$post_apply_environment")" != false ]]; then
  if [[ "$created_environment" == true ]]; then
    echo 'credential-migration was newly created with admin bypass enabled; disable "Allow administrators to bypass configured protection rules" in Settings -> Environments, then re-run before opening any switch' >&2
  else
    echo 'disable "Allow administrators to bypass configured protection rules" for environment credential-migration in Settings -> Environments, then re-run' >&2
  fi
  exit 1
fi

if [[ "$(jq -r .deployment_branch_policy.custom_branch_policies "$policy")" == true ]]; then
  live="$(gh api --paginate --slurp "repos/$repository/environments/$environment/deployment-branch-policies?per_page=100" | jq -c 'map(.branch_policies) | add // []')"
  desired_policies="$(jq -r '[.branch_policies[] | [.name,.type] | @tsv] | .[]' "$policy")"
  while IFS=$'\t' read -r name type; do
    [[ -n "$name" && -n "$type" ]] || continue
    if ! jq -e --arg name "$name" --arg type "$type" 'any(.[]; .name == $name and .type == $type)' <<<"$live" >/dev/null; then
      gh api --method POST "repos/$repository/environments/$environment/deployment-branch-policies" \
        -f name="$name" -f type="$type" --silent
    fi
  done <<<"$desired_policies"
fi

bash "$root/scripts/check-credential-migration-environment.sh"
