#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "check-production-environment.sh must be executed by path, not sourced or piped to Bash" >&2
  if [[ -n "${BASH_SOURCE[0]:-}" ]]; then return 1; fi
  exit 1
fi
set -euo pipefail

root="$(CDPATH='' cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null && pwd)"
if [[ -n "${GITHUB_REPOSITORY:-}" ]]; then
  repository="$GITHUB_REPOSITORY"
else
  repository="$(gh repo view "$(git -C "$root" remote get-url origin)" --json nameWithOwner --jq .nameWithOwner)"
fi
policy="$root/config/production-environment.json"
bootstrap_workflow="$root/.github/workflows/migrate-production-credentials.yml"
bootstrap_policy_enabled="$(jq -r 'any(.branch_policies[]; .name == "main" and .type == "branch")' "$policy")"
bootstrap_workflow_present=false
[[ ! -f "$bootstrap_workflow" ]] || bootstrap_workflow_present=true
if [[ "$bootstrap_policy_enabled" != "$bootstrap_workflow_present" ]]; then
  echo "the temporary main environment policy and credential-migration workflow must be added or removed together" >&2
  exit 1
fi
migration_variable_endpoint="repos/$repository/actions/variables/CREDENTIAL_MIGRATION_OPEN"
migration_variable_open=false
if migration_variable="$(gh api "$migration_variable_endpoint" 2>/dev/null)"; then
  if [[ "$(jq -r '.value // ""' <<<"$migration_variable")" != true ]]; then
    echo "CREDENTIAL_MIGRATION_OPEN must be absent or exactly true" >&2
    exit 1
  fi
  migration_variable_open=true
fi
expected="$(jq -Sc 'del(.environment_secret_names,.forbidden_repository_secret_names,.forbidden_repository_identity_secret_names) | .reviewers |= sort_by(.id) | .branch_policies |= sort_by(.name,.type)' "$policy")"
if ! environment="$(gh api "repos/$repository/environments/production" 2>/dev/null)"; then
  echo "production environment is missing; run scripts/apply-production-environment.sh using config/production-environment.json" >&2
  exit 1
fi
policies="$(gh api --paginate --slurp "repos/$repository/environments/production/deployment-branch-policies?per_page=100" | jq -c 'map(.branch_policies) | add')"
actual="$(jq -nSc --argjson environment "$environment" --argjson policies "$policies" '{
  wait_timer: ([ $environment.protection_rules[] | select(.type == "wait_timer") | .wait_timer ][0] // 0),
  prevent_self_review: ([ $environment.protection_rules[] | select(.type == "required_reviewers") | .prevent_self_review ][0] // false),
  reviewers: ([ $environment.protection_rules[] | select(.type == "required_reviewers") | .reviewers[] | {type, id:.reviewer.id, login:.reviewer.login} ] | sort_by(.id)),
  deployment_branch_policy: $environment.deployment_branch_policy,
  branch_policies: ($policies | map({name,type}) | sort_by(.name,.type))
}')"

if [[ "$actual" != "$expected" ]]; then
  echo "production environment differs from config/production-environment.json" >&2
  echo "expected: $expected" >&2
  echo "actual:   $actual" >&2
  exit 1
fi

environment_secret_names="$(gh api --paginate --slurp "repos/$repository/environments/production/secrets?per_page=100" | jq -c 'map(.secrets) | add | map(.name) | sort')"
required_environment_secret_names="$(jq -c '.environment_secret_names | sort' "$policy")"
if [[ "$environment_secret_names" != "$required_environment_secret_names" ]]; then
  echo "production environment secrets differ from config/production-environment.json" >&2
  echo "expected: $required_environment_secret_names" >&2
  echo "actual:   $environment_secret_names" >&2
  exit 1
fi

repository_secret_names="$(gh api --paginate --slurp "repos/$repository/actions/secrets?per_page=100" | jq -c 'map(.secrets) | add | map(.name)')"
forbidden_repository_secret_names="$(jq -c '.forbidden_repository_secret_names' "$policy")"
repository_credentials_present="$(jq -r --argjson forbidden "$forbidden_repository_secret_names" 'any(.[]; . as $name | any($forbidden[]; . == $name))' <<<"$repository_secret_names")"
forbidden_repository_identity_secret_names="$(jq -c '.forbidden_repository_identity_secret_names' "$policy")"
repository_identity_present="$(jq -r --argjson forbidden "$forbidden_repository_identity_secret_names" 'any(.[]; . as $name | any($forbidden[]; . == $name))' <<<"$repository_secret_names")"
if [[ "$repository_identity_present" == true ]]; then
  echo "dedicated reviewer or release identity credentials must not be repository-scoped Actions secrets" >&2
  exit 1
fi
if [[ "$repository_credentials_present" == true ]]; then
  if [[ "$bootstrap_workflow_present" == true && "$migration_variable_open" != true ]]; then
    echo "production credentials remain repository-scoped; open the migration window, then migrate and delete them before this audit can pass" >&2
  elif [[ "$bootstrap_workflow_present" == true ]]; then
    echo "production credentials remain repository-scoped while the migration window is open; migrate and delete them before this audit can pass" >&2
  else
    echo "production credentials must not be repository-scoped Actions secrets" >&2
  fi
  exit 1
fi
if [[ "$migration_variable_open" == true ]]; then
  echo "CREDENTIAL_MIGRATION_OPEN must be deleted after repository credentials are migrated" >&2
  exit 1
fi
if [[ "$bootstrap_workflow_present" == true && "$repository_credentials_present" == false ]] &&
   gh api "repos/$repository/contents/.github/workflows/migrate-production-credentials.yml?ref=main" >/dev/null 2>&1; then
  echo "credential migration is complete; remove its workflow and temporary main environment policy in the next reviewed PR" >&2
  exit 1
fi
echo "Production environment OK: separate release approval, v* tags plus temporary main bootstrap, and environment-only credentials are active"
