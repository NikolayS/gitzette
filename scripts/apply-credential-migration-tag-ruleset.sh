#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "apply-credential-migration-tag-ruleset.sh must be executed by path, not sourced or piped to Bash" >&2
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
case "$(jq -r length <<<"$matches")" in
  0) gh api --method POST "repos/$repository/rulesets" --input "$policy" --silent ;;
  1)
    ruleset_id="$(jq -er '.[0].id' <<<"$matches")"
    gh api --method PUT "repos/$repository/rulesets/$ruleset_id" --input "$policy" --silent
    ;;
  *) echo "refusing to reconcile duplicate credential migration tag rulesets" >&2; exit 1 ;;
esac

bash "$root/scripts/check-credential-migration-tag-ruleset.sh"
