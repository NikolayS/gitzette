#!/usr/bin/env bash
set -euo pipefail

unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_D1_TOKEN
# shellcheck source=scripts/require-wrangler.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/require-wrangler.sh"

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
bun -e '
  const fs = require("fs");
  const canonical = sql => String(sql)
    .replace(/CREATE (TABLE|INDEX|TRIGGER|VIEW) IF NOT EXISTS/gi, "CREATE $1")
    .replace(/^CREATE TABLE "([A-Za-z0-9_]+)"/i, "CREATE TABLE $1")
    .replace(/\s+/g, " ").replace(/\s*([(),])\s*/g, "$1").trim();
  const read = path => JSON.parse(fs.readFileSync(path, "utf8"))[0].results
    .map(row => ({ type: row.type, name: row.name, sql: canonical(row.sql) }));
  const baseline = read(process.argv[2]);
  const production = read(process.argv[3]);
  if (JSON.stringify(baseline) !== JSON.stringify(production)) {
    console.error("0000_base.sql differs from committed production snapshot", { baseline, production });
    process.exit(1);
  }
' "$baseline_state/schema.json" "$fixture_state/schema.json"

echo "Production baseline OK: 0000_base.sql matches the committed read-only D1 snapshot"
