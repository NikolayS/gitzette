#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -n "${GITHUB_REPOSITORY:-}" ]]; then
  repository="$GITHUB_REPOSITORY"
else
  repository="$(gh repo view "$(git -C "$root" remote get-url origin)" --json nameWithOwner --jq .nameWithOwner)"
fi
expected="$(jq -Sc '.' "$root/config/production-environment.json")"
environment="$(gh api "repos/$repository/environments/production")"
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

echo "Production environment OK: two-person approval and v* tag restriction are active"
