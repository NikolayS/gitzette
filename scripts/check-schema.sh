#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "check-schema.sh must be executed by path, not through stdin" >&2
  if [[ -n "${BASH_SOURCE[0]:-}" ]]; then return 1; fi
  exit 1
fi
set -euo pipefail

# shellcheck source=scripts/require-wrangler.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/require-wrangler.sh"
gitzette_require_checked_in_caller \
  "check-schema.sh" "${BASH_SOURCE[0]:-}" "$0" "schema-equivalence.ts"
gitzette_require_local

migration_state="$(mktemp -d)"
schema_state="$(mktemp -d)"
cleanup() {
  rm -rf "$migration_state" "$schema_state"
}
trap cleanup EXIT

local_wrangler d1 migrations apply gitzette-db --local --persist-to "$migration_state" >/dev/null
local_wrangler d1 execute gitzette-db --local --persist-to "$schema_state" --file schema.sql >/dev/null

query="SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations' ORDER BY type,name"
local_wrangler d1 execute gitzette-db --local --persist-to "$migration_state" --command "$query" --json >"$migration_state/schema.json"
local_wrangler d1 execute gitzette-db --local --persist-to "$schema_state" --command "$query" --json >"$schema_state/schema.json"

bun "$gitzette_scripts_directory/schema-equivalence.ts" \
  "$migration_state/schema.json" "$schema_state/schema.json" \
  "schema.sql differs from migrations" --strict

echo "Schema OK: schema.sql matches the complete migration chain"
