#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "check-credential-migration-inventory.sh must be executed by path, not sourced or piped to Bash" >&2
  if [[ -n "${BASH_SOURCE[0]:-}" ]]; then return 1; fi
  exit 1
fi
set -euo pipefail

root="$(CDPATH='' cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null && pwd)"
repository="${GITHUB_REPOSITORY:-$(gh repo view "$(git -C "$root" remote get-url origin)" --json nameWithOwner --jq .nameWithOwner)}"
allowed_production='["CLOUDFLARE_ACCOUNT_ID","CLOUDFLARE_API_TOKEN"]'
require_production_credentials="${REQUIRE_PRODUCTION_CREDENTIALS:-false}"
require_no_repository_credentials="${REQUIRE_NO_REPOSITORY_CREDENTIALS:-false}"
if [[ "$require_production_credentials" != true && "$require_production_credentials" != false ]]; then
  echo "REQUIRE_PRODUCTION_CREDENTIALS must be exactly true or false" >&2
  exit 1
fi
if [[ "$require_no_repository_credentials" != true && "$require_no_repository_credentials" != false ]]; then
  echo "REQUIRE_NO_REPOSITORY_CREDENTIALS must be exactly true or false" >&2
  exit 1
fi
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
if [[ "$require_no_repository_credentials" == true ]]; then
  if ! repository_secrets="$(gh api --paginate --slurp "repos/$repository/actions/secrets?per_page=100" 2>"$error_file" | jq -c 'map(.secrets) | add // []')"; then
    echo "unable to read repository Actions secrets with the operator token:" >&2
    sed 's/^/  /' "$error_file" >&2
    exit 3
  fi
  if ! jq -e 'all(.[]; .name | startswith("CLOUDFLARE_") | not)' <<<"$repository_secrets" >/dev/null; then
    echo "repository Cloudflare credential copies must be absent before environment verification" >&2
    exit 1
  fi
fi
if ! production_variables="$(gh api --paginate --slurp "repos/$repository/environments/production/variables?per_page=100" 2>"$error_file" | jq -c 'map(.variables) | add // []')"; then
  echo "unable to read production environment variables with the operator token:" >&2
  sed 's/^/  /' "$error_file" >&2
  exit 3
fi
if ! production_secrets="$(gh api --paginate --slurp "repos/$repository/environments/production/secrets?per_page=100" 2>"$error_file" | jq -c 'map(.secrets) | add // []')"; then
  echo "unable to read production environment secrets with the operator token:" >&2
  sed 's/^/  /' "$error_file" >&2
  exit 3
fi
if [[ "$(jq -r 'length' <<<"$production_variables")" -ne 0 ]]; then
  echo "production environment must not define variables that can shadow repository migration switches" >&2
  exit 1
fi
production_secret_names="$(jq -c '[.[].name] | sort' <<<"$production_secrets")"
if [[ "$require_production_credentials" == true ]]; then
  expected_production_names="$(jq -c 'sort' <<<"$allowed_production")"
  if [[ "$production_secret_names" != "$expected_production_names" ]]; then
    echo "production must contain exactly both reviewed Cloudflare secrets after installation" >&2
    exit 1
  fi
elif [[ "$production_secret_names" != '[]' &&
        "$production_secret_names" != "$(jq -c 'sort' <<<"$allowed_production")" ]]; then
  echo "production secrets must be empty before migration or exactly the reviewed Cloudflare pair" >&2
  exit 1
fi
echo "Credential migration inventory OK: migration and production environments cannot shadow switches or expose unexpected secrets"
