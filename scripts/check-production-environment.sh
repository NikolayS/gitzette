#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -n "${GITHUB_REPOSITORY:-}" ]]; then
  repository="$GITHUB_REPOSITORY"
else
  repository="$(gh repo view "$(git -C "$root" remote get-url origin)" --json nameWithOwner --jq .nameWithOwner)"
fi
case "${1:-default}" in
  default) policy="$root/config/production-environment.json" ;;
  migration) policy="$root/config/production-environment-migration.json" ;;
  *) echo "usage: $0 [default|migration]" >&2; exit 2 ;;
esac
expected="$(jq -Sc '.reviewers |= sort_by(.id) | .branch_policies |= sort_by(.name,.type)' "$policy")"
error_file="$(mktemp)"
trap 'rm -f "$error_file"' EXIT
if ! environment="$(gh api "repos/$repository/environments/production" 2>"$error_file")"; then
  if grep -Eq 'HTTP 404([^0-9]|$)' "$error_file"; then
    echo "production environment is missing; run scripts/apply-production-environment.sh default" >&2
  else
    echo "unable to read production environment; apply only after resolving this API error:" >&2
  fi
  sed 's/^/  /' "$error_file" >&2
  exit 1
fi
policies="$(gh api --paginate --slurp "repos/$repository/environments/production/deployment-branch-policies?per_page=100" | jq -c 'map(.branch_policies) | add // []')"
actual="$(jq -nSc --argjson environment "$environment" --argjson policies "$policies" '{
  wait_timer: ([ $environment.protection_rules[] | select(.type == "wait_timer") | .wait_timer ][0] // 0),
  can_admins_bypass: $environment.can_admins_bypass,
  prevent_self_review: ([ $environment.protection_rules[] | select(.type == "required_reviewers") | .prevent_self_review ][0] // false),
  reviewers: ([ $environment.protection_rules[] | select(.type == "required_reviewers") | .reviewers[] | {type, id:.reviewer.id, login:.reviewer.login} ] | sort_by(.id)),
  deployment_branch_policy: $environment.deployment_branch_policy,
  branch_policies: ($policies | map({name,type}) | sort_by(.name,.type))
}')"

if [[ "$actual" != "$expected" ]]; then
  echo "production environment differs from $(basename "$policy")" >&2
  echo "expected: $expected" >&2
  echo "actual:   $actual" >&2
  exit 1
fi

policy_names="$(jq -r '.branch_policies | map(.name) | join(", ")' "$policy")"
echo "Production environment OK: two-person approval; admitted refs: $policy_names"
