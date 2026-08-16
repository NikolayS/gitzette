#!/usr/bin/env bash
set -euo pipefail

repository="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
expected="$(jq -Sc 'del(.audit_command) | .required_status_checks.checks |= sort_by(.context)' config/main-branch-protection.json)"
actual="$(gh api "repos/$repository/branches/main/protection" | jq -Sc '{required_status_checks:{strict:.required_status_checks.strict,checks:(.required_status_checks.checks|sort_by(.context))},enforce_admins:.enforce_admins.enabled,required_conversation_resolution:.required_conversation_resolution.enabled,allow_force_pushes:.allow_force_pushes.enabled,allow_deletions:.allow_deletions.enabled,required_linear_history:.required_linear_history.enabled}')"

if [[ "$actual" != "$expected" ]]; then
  echo "main branch protection differs from config/main-branch-protection.json" >&2
  echo "expected: $expected" >&2
  echo "actual:   $actual" >&2
  exit 1
fi

echo "Branch protection OK: base-controlled review gate, exact-head verdict, and CI are required for admins"
