#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "check-credential-migration-environment.sh must be executed by path, not sourced or piped to Bash" >&2
  if [[ -n "${BASH_SOURCE[0]:-}" ]]; then return 1; fi
  exit 1
fi
set -euo pipefail

root="$(CDPATH='' cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null && pwd)"
repository="${GITHUB_REPOSITORY:-$(gh repo view "$(git -C "$root" remote get-url origin)" --json nameWithOwner --jq .nameWithOwner)}"
policy="$root/config/credential-migration-environment.json"
error_file="$(mktemp)"
trap 'rm -f "$error_file"' EXIT
if ! environment="$(gh api "repos/$repository/environments/credential-migration" 2>"$error_file")"; then
  if grep -Eq 'HTTP 404([^0-9]|$)' "$error_file"; then
    echo "credential-migration environment is missing; run scripts/apply-credential-migration-environment.sh" >&2
  else
    echo "unable to read credential-migration environment; apply only after resolving this API error:" >&2
  fi
  sed 's/^/  /' "$error_file" >&2
  exit 3
fi
if [[ "$(jq -r .deployment_branch_policy.custom_branch_policies <<<"$environment")" == true ]]; then
  if ! policies="$(gh api --paginate --slurp "repos/$repository/environments/credential-migration/deployment-branch-policies?per_page=100" 2>"$error_file" | jq -c 'map(.branch_policies) | add // []')"; then
    echo "unable to read credential-migration deployment branch policies:" >&2
    sed 's/^/  /' "$error_file" >&2
    exit 3
  fi
else
  policies='[]'
fi
variables="$(gh api --paginate --slurp "repos/$repository/environments/credential-migration/variables?per_page=100" | jq -c 'map(.variables) | add // []')"
secrets="$(gh api --paginate --slurp "repos/$repository/environments/credential-migration/secrets?per_page=100" | jq -c 'map(.secrets) | add // []')"
if [[ "$(jq -r 'length' <<<"$variables")" -ne 0 || "$(jq -r 'length' <<<"$secrets")" -ne 0 ]]; then
  echo "credential-migration environment must not define variables or secrets" >&2
  exit 1
fi
expected="$(jq -Sc '.reviewers |= sort_by(.id) | .branch_policies |= sort_by(.name,.type)' "$policy")"
actual="$(jq -nSc --argjson environment "$environment" --argjson policies "$policies" '{
  wait_timer: ([ $environment.protection_rules[] | select(.type == "wait_timer") | .wait_timer ][0] // 0),
  can_admins_bypass: $environment.can_admins_bypass,
  prevent_self_review: ([ $environment.protection_rules[] | select(.type == "required_reviewers") | .prevent_self_review ][0] // false),
  reviewers: ([ $environment.protection_rules[] | select(.type == "required_reviewers") | .reviewers[] | {type, id:.reviewer.id, login:.reviewer.login} ] | sort_by(.id)),
  deployment_branch_policy: $environment.deployment_branch_policy,
  branch_policies: ($policies | map({name,type}) | sort_by(.name,.type))
}')"
if [[ "$actual" != "$expected" ]]; then
  expected_without_bypass="$(jq -Sc 'del(.can_admins_bypass)' <<<"$expected")"
  actual_without_bypass="$(jq -Sc 'del(.can_admins_bypass)' <<<"$actual")"
  if [[ "$expected_without_bypass" == "$actual_without_bypass" &&
        "$(jq -r .can_admins_bypass <<<"$expected")" == false &&
        "$(jq -r .can_admins_bypass <<<"$actual")" == true ]]; then
    echo 'disable "Allow administrators to bypass configured protection rules" for environment credential-migration in Settings -> Environments, then re-run' >&2
    exit 1
  fi
  echo "credential-migration environment differs from reviewed policy" >&2
  echo "expected: $expected" >&2
  echo "actual:   $actual" >&2
  exit 1
fi
echo "Credential migration environment OK: Nik-only approval, self-review blocked, protected branches only"
