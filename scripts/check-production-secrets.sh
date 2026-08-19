#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" ]]; then
  echo "check-production-secrets.sh must run as bash scripts/check-production-secrets.sh from its checked-in path, not through stdin or a non-Bash shell" >&2
  exit 1
fi
set -euo pipefail

# Supported contract: execute this checked-in file by absolute, repository-relative,
# or Bash-resolved PATH name. Symlinked wrappers are intentionally unsupported.
production_secrets_script_directory="$(
  CDPATH='' cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null && pwd
)"
readonly production_secrets_script_directory
production_secrets_invocation_path="$production_secrets_script_directory/$(basename -- "${BASH_SOURCE[0]}")"
readonly production_secrets_invocation_path
production_secrets_executable_path="$0"
if [[ "$production_secrets_executable_path" != */* ]]; then
  if [[ -e "$production_secrets_executable_path" ]]; then
    production_secrets_executable_path="$PWD/$production_secrets_executable_path"
  else
    production_secrets_executable_path="$(type -P -- "$production_secrets_executable_path" || true)"
  fi
fi
readonly production_secrets_executable_path
if [[ ! -r "$production_secrets_script_directory/require-wrangler.sh" ]]; then
  echo "cannot find require-wrangler.sh under resolved script directory $production_secrets_script_directory" >&2
  exit 1
fi
# shellcheck source=scripts/require-wrangler.sh
source "$production_secrets_script_directory/require-wrangler.sh"
gitzette_require_checked_in_caller \
  "check-production-secrets.sh" "$production_secrets_invocation_path" \
  "$production_secrets_executable_path" "check-production-secrets.ts"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN is required to verify Worker secrets" >&2
  exit 1
fi

secret_json="$(mktemp)"
trap 'rm -f "$secret_json"' EXIT
"$wrangler_bin" secret list --format json >"$secret_json"
bun "$production_secrets_script_directory/check-production-secrets.ts" "$secret_json"

echo "Production secrets OK: required bindings exist and retired provider credentials are absent"
