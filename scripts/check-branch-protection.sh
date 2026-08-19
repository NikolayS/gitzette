#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repository="${GITHUB_REPOSITORY:-$(gh repo view "$(git -C "$root" remote get-url origin)" --json nameWithOwner --jq .nameWithOwner)}"
expected="$(jq -Sc 'del(.audit_command,.allow_auto_merge) | .required_status_checks.checks |= sort_by(.context)' "$root/config/main-branch-protection.json")"
expected_auto_merge="$(jq -r .allow_auto_merge "$root/config/main-branch-protection.json")"
actual_auto_merge="$(gh api "repos/$repository" --jq .allow_auto_merge)"
if [[ "$actual_auto_merge" != "$expected_auto_merge" ]]; then
  echo "repository allow_auto_merge differs from config/main-branch-protection.json" >&2
  exit 1
fi
protection="$(gh api "repos/$repository/branches/main/protection")"
workflow_permissions="$(gh api "repos/$repository/actions/permissions/workflow")"
ruleset_summaries="$(gh api --paginate --slurp "repos/$repository/rulesets?includes_parents=true&per_page=100" | jq -c 'add')"
rulesets='[]'
while IFS= read -r ruleset_url; do
  ruleset="$(gh api "$ruleset_url")"
  rulesets="$(jq -c --argjson ruleset "$ruleset" '. + [$ruleset]' <<<"$rulesets")"
done < <(jq -r '.[]._links.self.href' <<<"$ruleset_summaries")
actual="$(jq -nSc --argjson protection "$protection" --argjson workflow_permissions "$workflow_permissions" --argjson rulesets "$rulesets" -f "$root/scripts/normalize-branch-protection.jq")"

if [[ "$actual" != "$expected" ]]; then
  echo "main branch protection differs from config/main-branch-protection.json" >&2
  echo "expected: $expected" >&2
  echo "actual:   $actual" >&2
  if [[ "$(jq -c '.repository_rulesets' <<<"$actual")" != "$(jq -c '.repository_rulesets' <<<"$expected")" ]]; then
    echo "effective repository rulesets differ; reconcile them manually before rerunning the audit" >&2
  fi
  exit 1
fi

echo "Branch protection OK: only repository administrators can update main, and they remain subject to pull requests, exact-head technical gates, and resolved conversations; approval count is zero"
