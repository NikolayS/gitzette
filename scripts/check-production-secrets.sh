#!/usr/bin/env bash
set -euo pipefail
production_secrets_script_source="${BASH_SOURCE[0]}"
production_secrets_symlink_hops=0
while [[ -L "$production_secrets_script_source" ]]; do
  production_secrets_symlink_hops=$((production_secrets_symlink_hops + 1))
  if [[ "$production_secrets_symlink_hops" -gt 40 ]]; then
    echo "too many symlinks resolving check-production-secrets.sh" >&2
    exit 1
  fi
  production_secrets_script_directory="$(cd -P -- "$(dirname -- "$production_secrets_script_source")" && pwd)"
  production_secrets_script_source="$(readlink "$production_secrets_script_source")"
  if [[ "$production_secrets_script_source" != /* ]]; then
    production_secrets_script_source="$production_secrets_script_directory/$production_secrets_script_source"
  fi
done
production_secrets_script_directory="$(cd -P -- "$(dirname -- "$production_secrets_script_source")" && pwd)"
unset production_secrets_script_source production_secrets_symlink_hops
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
