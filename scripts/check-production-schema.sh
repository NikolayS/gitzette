#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=scripts/require-wrangler.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/require-wrangler.sh"

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
schema_exclusions="'d1_migrations'"
if [[ -f config/credential-migration-environment.json ]]; then
  schema_exclusions+=",'credential_migration_transfer'"
fi
query="SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT IN ($schema_exclusions) ORDER BY type,name"
local_wrangler d1 execute gitzette-db --local --persist-to "$migration_state" --command "$query" --json >"$migration_state/schema.json"
"$wrangler_bin" d1 execute gitzette-db --remote --command "$query" --json >"$remote_json"
bun scripts/schema-equivalence.ts "$migration_state/schema.json" "$remote_json"

echo "Production schema OK: live D1 matches the complete reviewed migration chain"
