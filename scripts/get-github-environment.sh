#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "get-github-environment.sh must be executed by path, not sourced or piped to Bash" >&2
  if [[ -n "${BASH_SOURCE[0]:-}" ]]; then return 1; fi
  exit 1
fi
set -euo pipefail

if [[ "$#" -ne 2 || ! "$1" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ||
      ! "$2" =~ ^[A-Za-z0-9_.-]+$ ]]; then
  echo "usage: $0 OWNER/REPOSITORY ENVIRONMENT" >&2
  exit 2
fi
repository="$1"
environment="$2"
response_file="$(mktemp)"
error_file="$(mktemp)"
trap 'rm -f "$response_file" "$error_file"' EXIT

if gh api "repos/$repository/environments/$environment" >"$response_file" 2>"$error_file"; then
  cat "$response_file"
  exit 0
fi

if ! gh api --include "repos/$repository/environments/$environment" >"$response_file" 2>"$error_file"; then
  :
fi
status_code="$(sed -n '1s/^HTTP\/[^ ]* \([0-9][0-9][0-9]\).*/\1/p' "$response_file")"
if [[ "$status_code" != 404 ]]; then
  echo "environment lookup failed with HTTP status ${status_code:-unknown}:" >&2
  sed 's/^/  /' "$error_file" >&2
  exit 3
fi

if ! inventory="$(gh api --paginate --slurp "repos/$repository/environments?per_page=100" 2>"$error_file")"; then
  echo "unable to distinguish a missing environment from a permission-masked 404:" >&2
  sed 's/^/  /' "$error_file" >&2
  exit 3
fi
if jq -e --arg environment "$environment" '
  map(.environments) | add // [] | any(.name == $environment)
' <<<"$inventory" >/dev/null; then
  echo "environment inventory contains $environment but its endpoint returned 404; refusing to treat this as missing" >&2
  exit 3
fi

echo "$environment environment is absent from the readable repository inventory" >&2
exit 4
