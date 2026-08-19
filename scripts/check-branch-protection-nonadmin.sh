#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "check-branch-protection-nonadmin.sh must be executed by path, not sourced or piped to Bash" >&2
  if [[ -n "${BASH_SOURCE[0]:-}" ]]; then return 1; fi
  exit 1
fi
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN must be the samo-agent token}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repository="${GITHUB_REPOSITORY:-NikolayS/gitzette}"
expected_id=280144521
ruleset_name="$(jq -er '.repository_rulesets[0].name' "$root/config/main-branch-protection.json")"
permission="$(gh api "repos/$repository/collaborators/samo-agent/permission")"
if [[ "$(jq -er .user.id <<<"$permission")" != "$expected_id" ||
      "$(jq -er .permission <<<"$permission")" == admin ]]; then
  echo "samo-agent identity or repository role differs from the non-admin boundary" >&2
  exit 1
fi
ruleset_ids="$(gh api --paginate --slurp "repos/$repository/rulesets?includes_parents=false&per_page=100" |
  jq -r --arg name "$ruleset_name" 'add // [] | .[] | select(.name == $name) | .id')"
if [[ "$(wc -w <<<"$ruleset_ids")" -ne 1 ]]; then
  echo "expected exactly one live $ruleset_name ruleset" >&2
  exit 1
fi
live="$(gh api "repos/$repository/rulesets/$ruleset_ids")"
if [[ "$(jq -r .current_user_can_bypass <<<"$live")" != never ]]; then
  echo "samo-agent can bypass the admin-only main update ruleset" >&2
  exit 1
fi
echo "Non-admin ruleset boundary OK: samo-agent ID 280144521 cannot bypass main updates"
