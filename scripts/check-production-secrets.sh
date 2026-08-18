#!/usr/bin/env bash
gitzette_production_secrets_script_directory() {
  local script_source="$1"
  local script_directory
  local link_target
  local symlink_hops=0

  while [[ -L "$script_source" ]]; do
    if ((symlink_hops >= 40)); then
      echo "check-production-secrets.sh symlink resolution exceeded 40 hops" >&2
      return 1
    fi
    script_directory="$(cd -P -- "$(dirname -- "$script_source")" && pwd)"
    link_target="$(readlink -- "$script_source")"
    if [[ "$link_target" = /* ]]; then
      script_source="$link_target"
    else
      script_source="$script_directory/$link_target"
    fi
    ((symlink_hops += 1))
  done

  cd -P -- "$(dirname -- "$script_source")"
  pwd
}

if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  return 0
fi

set -euo pipefail

production_secrets_script_source="${BASH_SOURCE[0]}"
if [[ "$production_secrets_script_source" != */* ]]; then
  production_secrets_script_source="$(command -v -- "$production_secrets_script_source")"
fi
production_secrets_script_directory="$(
  gitzette_production_secrets_script_directory "$production_secrets_script_source"
)"
unset production_secrets_script_source
unset -f gitzette_production_secrets_script_directory
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
