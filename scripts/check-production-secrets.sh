#!/usr/bin/env bash
set -euo pipefail
script_source="${BASH_SOURCE[0]}"
while [[ -L "$script_source" ]]; do
  script_directory="$(cd -P -- "$(dirname -- "$script_source")" && pwd)"
  script_source="$(readlink "$script_source")"
  if [[ "$script_source" != /* ]]; then
    script_source="$script_directory/$script_source"
  fi
done
script_directory="$(cd -P -- "$(dirname -- "$script_source")" && pwd)"
readonly script_directory
unset script_source
# shellcheck source=scripts/require-wrangler.sh
source "$script_directory/require-wrangler.sh"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN is required to verify Worker secrets" >&2
  exit 1
fi

secret_json="$(mktemp)"
trap 'rm -f "$secret_json"' EXIT
"$wrangler_bin" secret list --format json >"$secret_json"
bun "$script_directory/check-production-secrets.ts" "$secret_json"

echo "Production secrets OK: required bindings exist and retired provider credentials are absent"
