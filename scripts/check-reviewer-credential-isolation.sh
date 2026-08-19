#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "check-reviewer-credential-isolation.sh must be executed by path, not sourced or piped to Bash" >&2
  if [[ -n "${BASH_SOURCE[0]:-}" ]]; then return 1; fi
  exit 1
fi
set -euo pipefail

root="$(CDPATH='' cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null && pwd)"
repository="${GITHUB_REPOSITORY:-$(gh repo view "$(git -C "$root" remote get-url origin)" --json nameWithOwner --jq .nameWithOwner)}"
allowed_cloudflare='["CLOUDFLARE_ACCOUNT_ID","CLOUDFLARE_API_TOKEN"]'

repository_secrets="$(gh api --paginate --slurp "repos/$repository/actions/secrets?per_page=100" | jq -c 'map(.secrets) | add // []')"
if ! jq -e --argjson allowed "$allowed_cloudflare" 'all(.[]; .name as $name | $allowed | index($name))' <<<"$repository_secrets" >/dev/null; then
  echo "repository contains a secret outside the reviewed Cloudflare migration allowlist" >&2
  exit 1
fi

environments="$(gh api --paginate --slurp "repos/$repository/environments?per_page=100" | jq -c 'map(.environments) | add // []')"
while IFS= read -r environment; do
  secrets="$(gh api --paginate --slurp "repos/$repository/environments/$environment/secrets?per_page=100" | jq -c 'map(.secrets) | add // []')"
  if [[ "$environment" == production ]]; then
    if ! jq -e --argjson allowed "$allowed_cloudflare" 'all(.[]; .name as $name | $allowed | index($name))' <<<"$secrets" >/dev/null; then
      echo "production contains a secret outside the reviewed Cloudflare allowlist" >&2
      exit 1
    fi
  elif [[ "$(jq length <<<"$secrets")" -ne 0 ]]; then
    echo "$environment contains an unexpected environment secret" >&2
    exit 1
  fi
done < <(jq -r '.[].name' <<<"$environments")

echo "Reviewer credential isolation OK: no repository or environment secret can name an external review credential"
