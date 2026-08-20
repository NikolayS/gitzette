#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=./require-wrangler.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/require-wrangler.sh"

# Before applying any pending migration, prove that live D1 still matches a
# clean replay of the migrations already recorded in its ledger.

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN is required for the read-only applied-schema gate" >&2
  exit 1
fi

migration_state="$(mktemp -d)"
cutover_json="$(mktemp)"
ledger_json="$(mktemp)"
remote_json="$(mktemp)"
cleanup() {
  rm -rf "$migration_state"
  rm -f "$cutover_json" "$ledger_json" "$remote_json"
}
trap cleanup EXIT

"$wrangler_bin" d1 execute gitzette-db --remote --command \
  "SELECT COUNT(*) AS total FROM sqlite_master WHERE type='table' AND name='d1_migrations'" --json >"$cutover_json"
ledger_table_count="$(jq -r '.[0].results[0].total' "$cutover_json")"
if [[ "$ledger_table_count" -eq 0 ]]; then
  echo "Applied-schema gate skipped: pre-cutover baseline gate owns the unmigrated database"
  exit 0
fi

"$wrangler_bin" d1 execute gitzette-db --remote --command \
  "SELECT name FROM d1_migrations ORDER BY id" --json >"$ledger_json"
applied_json="$(bun scripts/applied-migrations.ts migrations "$ledger_json")"
while IFS= read -r migration_name; do
  local_wrangler d1 execute gitzette-db --local --persist-to "$migration_state" \
    --file "migrations/$migration_name" >/dev/null
done < <(jq -r '.[]' <<<"$applied_json")

query="SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations' ORDER BY type,name"
local_wrangler d1 execute gitzette-db --local --persist-to "$migration_state" --command "$query" --json >"$migration_state/schema.json"
"$wrangler_bin" d1 execute gitzette-db --remote --command "$query" --json >"$remote_json"
bun scripts/schema-equivalence.ts "$migration_state/schema.json" "$remote_json"

echo "Applied-schema gate OK: live D1 matches its reviewed migration-ledger prefix"
