#!/usr/bin/env bash
set -euo pipefail

repository="${GITHUB_REPOSITORY:-NikolayS/gitzette}"
expected="$(jq -Sc 'del(.audit_command) | .required_status_checks.contexts |= sort' config/main-branch-protection.json)"
actual="$(gh api "repos/$repository/branches/main/protection" | jq -Sc '{required_status_checks:{strict:.required_status_checks.strict,contexts:(.required_status_checks.contexts|sort)},enforce_admins:.enforce_admins.enabled,required_conversation_resolution:.required_conversation_resolution.enabled}')"

if [[ "$actual" != "$expected" ]]; then
  echo "main branch protection differs from config/main-branch-protection.json" >&2
  echo "expected: $expected" >&2
  echo "actual:   $actual" >&2
  exit 1
fi

echo "Branch protection OK: exact-head CI and samorev are required for admins"
