#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "check-reviewer-credential-isolation.sh must be executed by path, not sourced or piped to Bash" >&2
  if [[ -n "${BASH_SOURCE[0]:-}" ]]; then return 1; fi
  exit 1
fi
set -euo pipefail

root="$(CDPATH='' cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null && pwd)"
repository="${GITHUB_REPOSITORY:-$(gh repo view "$(git -C "$root" remote get-url origin)" --json nameWithOwner --jq .nameWithOwner)}"
allowed_cloudflare='["PRODUCTION_CLOUDFLARE_ACCOUNT_ID","PRODUCTION_CLOUDFLARE_API_TOKEN"]'
require_production_credentials="${REQUIRE_PRODUCTION_CREDENTIALS:-false}"
if [[ "$require_production_credentials" != true && "$require_production_credentials" != false ]]; then
  echo "REQUIRE_PRODUCTION_CREDENTIALS must be exactly true or false" >&2
  exit 1
fi
allowed_repository='["CLAUDE_CODE_OAUTH_TOKEN","CLOUDFLARE_ACCOUNT_ID","CLOUDFLARE_API_TOKEN"]'
if [[ "$require_production_credentials" == true ]]; then
  allowed_repository='["CLAUDE_CODE_OAUTH_TOKEN"]'
fi
error_file="$(mktemp)"
trap 'rm -f "$error_file"' EXIT

read_api() {
  local label="$1"
  shift
  local response
  if ! response="$(gh api "$@" 2>"$error_file")"; then
    echo "unable to read $label:" >&2
    sed 's/^/  /' "$error_file" >&2
    exit 3
  fi
  printf '%s\n' "$response"
}

collaborators="$(read_api "repository collaborators" --paginate --slurp "repos/$repository/collaborators?affiliation=all&per_page=100" | jq -c 'add // []')"
if ! jq -e '[.[] | select(.permissions.admin == true) | .id] == [1345402]' <<<"$collaborators" >/dev/null; then
  echo "repository administrator set must be exactly NikolayS (immutable ID 1345402); automation must not be an administrator" >&2
  exit 1
fi

repository_secrets="$(read_api "repository Actions secrets" --paginate --slurp "repos/$repository/actions/secrets?per_page=100" | jq -c 'map(.secrets) | add // []')"
if ! jq -e --argjson allowed "$allowed_repository" '
  all(.[]; .name as $name | $allowed | index($name))
' <<<"$repository_secrets" >/dev/null; then
  echo "repository contains a secret outside the reviewed Claude/migration allowlist" >&2
  exit 1
fi

repository_variables="$(read_api "repository Actions variables" --paginate --slurp "repos/$repository/actions/variables?per_page=100" | jq -c 'map(.variables) | add // []')"
if ! jq -e 'all(.[];
  (.name == "CREDENTIAL_EXPORT_OPEN" or .name == "CREDENTIAL_VERIFY_OPEN") and
  .value == "true")' <<<"$repository_variables" >/dev/null; then
  echo "repository Actions variables may only be CREDENTIAL_EXPORT_OPEN/CREDENTIAL_VERIFY_OPEN with value true; delete a variable to close a switch (false is residue)" >&2
  exit 1
fi

dependabot_secrets="$(read_api "Dependabot secrets" --paginate --slurp "repos/$repository/dependabot/secrets?per_page=100" | jq -c 'map(.secrets) | add // []')"
if [[ "$(jq length <<<"$dependabot_secrets")" -ne 0 ]]; then
  echo "repository contains an unexpected Dependabot secret" >&2
  exit 1
fi

environments="$(read_api "environment inventory" --paginate --slurp "repos/$repository/environments?per_page=100" | jq -c 'map(.environments) | add // []')"
if [[ "$(jq '[.[] | select(.name == "production")] | length' <<<"$environments")" -ne 1 ]]; then
  echo "repository must contain exactly one production environment" >&2
  exit 1
fi
while IFS= read -r environment; do
  if [[ ! "$environment" =~ ^[A-Za-z0-9_.-]+$ ]]; then
    echo "environment name cannot be safely audited: $environment" >&2
    exit 1
  fi
  secrets="$(read_api "$environment environment secrets" --paginate --slurp "repos/$repository/environments/$environment/secrets?per_page=100" | jq -c 'map(.secrets) | add // []')"
  variables="$(read_api "$environment environment variables" --paginate --slurp "repos/$repository/environments/$environment/variables?per_page=100" | jq -c 'map(.variables) | add // []')"
  if [[ "$(jq length <<<"$variables")" -ne 0 ]]; then
    echo "$environment contains an unexpected environment variable" >&2
    exit 1
  fi
  if [[ "$environment" == production ]]; then
    secret_names="$(jq -c '[.[].name] | sort' <<<"$secrets")"
    expected_names="$(jq -c 'sort' <<<"$allowed_cloudflare")"
    if [[ "$require_production_credentials" == true && "$secret_names" != "$expected_names" ]]; then
      echo "production must contain exactly both reviewed Cloudflare secrets" >&2
      exit 1
    fi
    if [[ "$require_production_credentials" == false &&
          "$secret_names" != '[]' && "$secret_names" != "$expected_names" ]]; then
      echo "production secrets must be empty before migration or exactly the reviewed Cloudflare pair" >&2
      exit 1
    fi
  elif [[ "$(jq length <<<"$secrets")" -ne 0 ]]; then
    echo "$environment contains an unexpected environment secret" >&2
    exit 1
  fi
done < <(jq -r '.[].name' <<<"$environments")

echo "Reviewer credential isolation OK: Actions variables and all Actions, environment, and Dependabot secret names satisfy the external-review isolation policy"
