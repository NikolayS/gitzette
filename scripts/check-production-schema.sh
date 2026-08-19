#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" ]]; then
  echo "check-production-schema.sh must be executed by path, not through stdin" >&2
  exit 1
fi
set -euo pipefail
# shellcheck source=scripts/require-wrangler.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/require-wrangler.sh"
gitzette_require_checked_in_caller \
  "check-production-schema.sh" "${BASH_SOURCE[0]:-}" "$0" "schema-equivalence.ts"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN is required for the read-only production schema assertion" >&2
  exit 1
fi

migration_state="$(mktemp -d)"
remote_json="$(mktemp)"
cleanup() {
  rm -rf "$migration_state"
  rm -f "$remote_json"
}
trap cleanup EXIT

local_wrangler d1 migrations apply gitzette-db --local --persist-to "$migration_state" >/dev/null
query="SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations' ORDER BY type,name"
local_wrangler d1 execute gitzette-db --local --persist-to "$migration_state" --command "$query" --json >"$migration_state/schema.json"
"$wrangler_bin" d1 execute gitzette-db --remote --command "$query" --json >"$remote_json"
bun "$gitzette_scripts_directory/schema-equivalence.ts" \
  "$migration_state/schema.json" "$remote_json" \
  "production schema differs from the complete migration chain"

echo "Production schema OK: live D1 matches the complete reviewed migration chain"
