#!/usr/bin/env bash
set -euo pipefail
production_secrets_script_source="${BASH_SOURCE[0]}"
while [[ -L "$production_secrets_script_source" ]]; do
  production_secrets_script_directory="$(cd -P -- "$(dirname -- "$production_secrets_script_source")" && pwd)"
  production_secrets_script_source="$(readlink -- "$production_secrets_script_source")"
  if [[ "$production_secrets_script_source" != /* ]]; then
    production_secrets_script_source="$production_secrets_script_directory/$production_secrets_script_source"
  fi
done
production_secrets_script_directory="$(cd -P -- "$(dirname -- "$production_secrets_script_source")" && pwd)"
unset production_secrets_script_source
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
