#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "check-credential-migration-tag-ruleset.sh must be executed by path, not sourced or piped to Bash" >&2
  if [[ -n "${BASH_SOURCE[0]:-}" ]]; then return 1; fi
  exit 1
fi
set -euo pipefail

root="$(CDPATH='' cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null && pwd)"
repository="${GITHUB_REPOSITORY:-$(gh repo view "$(git -C "$root" remote get-url origin)" --json nameWithOwner --jq .nameWithOwner)}"
policy="$root/config/credential-migration-tag-ruleset.json"
name="$(jq -er .name "$policy")"
matches="$(gh api --paginate --slurp "repos/$repository/rulesets?per_page=100" |
  jq -c --arg name "$name" '[map(.) | add // [] | .[] | select(.name == $name)]')"
if [[ "$(jq -r length <<<"$matches")" != 1 ]]; then
  echo "expected exactly one active credential migration tag ruleset" >&2
  exit 1
fi
ruleset_id="$(jq -er '.[0].id' <<<"$matches")"
live="$(gh api "repos/$repository/rulesets/$ruleset_id")"
expected="$(jq -Sc . "$policy")"
actual="$(jq -Sc '{name,target,enforcement,bypass_actors,conditions,rules}' <<<"$live")"
if [[ "$actual" != "$expected" ]]; then
  echo "credential migration tag ruleset differs from reviewed policy" >&2
  echo "expected: $expected" >&2
  echo "actual:   $actual" >&2
  exit 1
fi
echo "Credential migration tag ruleset OK: only Nik can create, update, or delete the fixed tag"
