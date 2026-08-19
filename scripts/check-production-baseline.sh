#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "check-production-baseline.sh must be executed by path, not through stdin" >&2
  if [[ -n "${BASH_SOURCE[0]:-}" ]]; then return 1; fi
  exit 1
fi
set -euo pipefail

# shellcheck source=scripts/require-wrangler.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/require-wrangler.sh"
gitzette_require_checked_in_caller \
  "check-production-baseline.sh" "${BASH_SOURCE[0]:-}" "$0" "schema-equivalence.ts"
gitzette_require_local

baseline_state="$(mktemp -d)"
fixture_state="$(mktemp -d)"
cleanup() {
  rm -rf "$baseline_state" "$fixture_state"
}
trap cleanup EXIT

local_wrangler d1 execute gitzette-db --local --persist-to "$baseline_state" --file migrations/0000_base.sql >/dev/null
local_wrangler d1 execute gitzette-db --local --persist-to "$fixture_state" --file fixtures/production-baseline-2026-08-15.sql >/dev/null

query="SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name"
local_wrangler d1 execute gitzette-db --local --persist-to "$baseline_state" --command "$query" --json >"$baseline_state/schema.json"
local_wrangler d1 execute gitzette-db --local --persist-to "$fixture_state" --command "$query" --json >"$fixture_state/schema.json"

bun "$gitzette_scripts_directory/schema-equivalence.ts" \
  "$baseline_state/schema.json" "$fixture_state/schema.json" \
  "0000_base.sql differs from committed production snapshot"

echo "Production baseline OK: 0000_base.sql matches the committed read-only D1 snapshot"
