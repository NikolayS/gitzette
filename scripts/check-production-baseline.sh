#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=scripts/require-wrangler.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/require-wrangler.sh"
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

# The Bun program intentionally receives shell values through argv.
# shellcheck disable=SC2016
bun "$(dirname -- "${BASH_SOURCE[0]}")/compare-production-baseline.cjs" "$baseline_state/schema.json" "$fixture_state/schema.json"

echo "Production baseline OK: 0000_base.sql matches the committed read-only D1 snapshot"
