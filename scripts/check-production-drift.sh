#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=scripts/require-wrangler.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/require-wrangler.sh"
gitzette_require_checked_in_caller \
  "check-production-drift.sh" "${BASH_SOURCE[0]:-}" "$0" \
  "username-collision-preflight.ts" "cutover-state.ts" "schema-equivalence.ts"

# This is a one-time pre-cutover baseline gate. After cutover, Wrangler's D1
# migration ledger records and applies reviewed migrations; this script does not
# continuously compare the live schema with the full applied migration chain.

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN is required for the read-only production drift gate" >&2
  exit 1
fi

fixture_state="$(mktemp -d)"
remote_json="$(mktemp)"
cutover_json="$(mktemp)"
ledger_json="$(mktemp)"
collision_json="$(mktemp)"
cleanup() {
  rm -rf "$fixture_state"
  rm -f "$remote_json" "$cutover_json" "$ledger_json" "$collision_json"
}
trap cleanup EXIT

# The captured fixture is the pre-migration production state and therefore is
# only valid for the 0000/0001 cutover. Once D1 records any migration, Wrangler's
# migration ledger owns subsequent changes and this one-time baseline gate must
# not compare the expanded schema with the old fixture.
"$wrangler_bin" d1 execute gitzette-db --remote --command \
  "SELECT COUNT(*) AS total FROM sqlite_master WHERE type='table' AND name='d1_migrations'" --json >"$cutover_json"
ledger_table_count="$(jq -r '.[0].results[0].total' "$cutover_json")"
"$wrangler_bin" d1 execute gitzette-db --remote --command \
  "SELECT lower(username) AS username,COUNT(*) AS total FROM users GROUP BY lower(username) HAVING COUNT(*)>1" \
  --json >"$collision_json"
bun "$gitzette_scripts_directory/username-collision-preflight.ts" "$collision_json"
echo "Production username collision preflight OK: zero case-fold collisions"

if [[ "$ledger_table_count" -gt 0 ]]; then
  "$wrangler_bin" d1 execute gitzette-db --remote --command \
    "SELECT name FROM d1_migrations ORDER BY id" --json >"$ledger_json"
  bun "$gitzette_scripts_directory/cutover-state.ts" "$cutover_json" "$ledger_json" >/dev/null
  echo "Production cutover gate skipped: D1 migration ledger already exists"
  exit 0
fi
if [[ "$(bun "$gitzette_scripts_directory/cutover-state.ts" "$cutover_json")" != "cutover" ]]; then
  echo "unexpected cutover state" >&2
  exit 1
fi

local_wrangler d1 execute gitzette-db --local --persist-to "$fixture_state" --file fixtures/production-baseline-2026-08-15.sql >/dev/null
query="SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations' ORDER BY type,name"
local_wrangler d1 execute gitzette-db --local --persist-to "$fixture_state" --command "$query" --json >"$fixture_state/schema.json"
"$wrangler_bin" d1 execute gitzette-db --remote --command "$query" --json >"$remote_json"

bun "$gitzette_scripts_directory/schema-equivalence.ts" \
  "$fixture_state/schema.json" "$remote_json" \
  "production schema drifted from the reviewed baseline; aborting migration"

echo "Production cutover gate OK: unmigrated live D1 matches the reviewed baseline"
