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
if ! environment="$(gh api "repos/$repository/environments/credential-migration" 2>/dev/null)"; then
  echo "credential-migration environment is missing; run scripts/apply-credential-migration-environment.sh" >&2
  exit 1
fi
policies="$(gh api --paginate --slurp "repos/$repository/environments/credential-migration/deployment-branch-policies?per_page=100" | jq -c 'map(.branch_policies) | add')"
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
  echo "credential-migration environment differs from reviewed policy" >&2
  echo "expected: $expected" >&2
  echo "actual:   $actual" >&2
  exit 1
fi
echo "Credential migration environment OK: Nik-only approval, self-review blocked, main only"
