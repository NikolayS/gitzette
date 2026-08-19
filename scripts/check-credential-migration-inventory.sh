#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "check-credential-migration-inventory.sh must be executed by path, not sourced or piped to Bash" >&2
  if [[ -n "${BASH_SOURCE[0]:-}" ]]; then return 1; fi
  exit 1
fi
set -euo pipefail

root="$(CDPATH='' cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null && pwd)"
repository="${GITHUB_REPOSITORY:-$(gh repo view "$(git -C "$root" remote get-url origin)" --json nameWithOwner --jq .nameWithOwner)}"
error_file="$(mktemp)"
trap 'rm -f "$error_file"' EXIT

if ! variables="$(gh api --paginate --slurp "repos/$repository/environments/credential-migration/variables?per_page=100" 2>"$error_file" | jq -c 'map(.variables) | add // []')"; then
  echo "unable to read credential-migration environment variables with the operator token:" >&2
  sed 's/^/  /' "$error_file" >&2
  exit 3
fi
if ! secrets="$(gh api --paginate --slurp "repos/$repository/environments/credential-migration/secrets?per_page=100" 2>"$error_file" | jq -c 'map(.secrets) | add // []')"; then
  echo "unable to read credential-migration environment secrets with the operator token:" >&2
  sed 's/^/  /' "$error_file" >&2
  exit 3
fi
if [[ "$(jq -r 'length' <<<"$variables")" -ne 0 || "$(jq -r 'length' <<<"$secrets")" -ne 0 ]]; then
  echo "credential-migration environment must not define variables or secrets" >&2
  exit 1
fi
echo "Credential migration inventory OK: no environment variables or secrets"
