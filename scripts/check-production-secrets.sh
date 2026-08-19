#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" ]]; then
  echo "check-production-secrets.sh must be executed from its checked-in path, not piped to bash" >&2
  exit 1
fi
if (return 0 2>/dev/null); then
  echo "check-production-secrets.sh must be executed, not sourced" >&2
  return 1
fi

set -euo pipefail

# Supported contract: execute this checked-in file by absolute, repository-relative,
# or Bash-resolved PATH name. Symlinked wrappers are intentionally unsupported.
production_secrets_script_directory="$(
  CDPATH='' cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null && pwd
)"
if [[ ! -r "$production_secrets_script_directory/require-wrangler.sh" ]]; then
  echo "cannot find require-wrangler.sh under resolved script directory $production_secrets_script_directory; execute the checked-in script by a supported path" >&2
  exit 1
fi
# shellcheck source=scripts/require-wrangler.sh
source "$production_secrets_script_directory/require-wrangler.sh"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN is required to verify Worker secrets" >&2
  exit 1
fi

secret_json="$(mktemp)"
trap 'rm -f "$secret_json"' EXIT
"$wrangler_bin" secret list --format json >"$secret_json"
bun "$production_secrets_script_directory/check-production-secrets.ts" "$secret_json"

echo "Production secrets OK: required bindings exist and retired provider credentials are absent"
