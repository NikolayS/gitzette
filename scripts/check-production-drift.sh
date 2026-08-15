#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN is required for the read-only production drift gate" >&2
  exit 1
fi

fixture_state="$(mktemp -d)"
remote_json="$(mktemp)"
cleanup() {
  rm -rf "$fixture_state"
  rm -f "$remote_json"
}
trap cleanup EXIT

bunx wrangler d1 execute gitzette-db --local --persist-to "$fixture_state" --file fixtures/production-baseline-2026-08-15.sql >/dev/null
query="SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations' ORDER BY type,name"
bunx wrangler d1 execute gitzette-db --local --persist-to "$fixture_state" --command "$query" --json >"$fixture_state/schema.json"
bunx wrangler d1 execute gitzette-db --remote --command "$query" --json >"$remote_json"

bun -e '
  const fs = require("fs");
  const canonical = sql => String(sql)
    .replace(/^CREATE TABLE "([A-Za-z0-9_]+)"/i, "CREATE TABLE $1")
    .replace(/\s+/g, " ").replace(/\s*([(),])\s*/g, "$1").trim();
  const read = path => JSON.parse(fs.readFileSync(path, "utf8"))[0].results
    .map(row => ({ type: row.type, name: row.name, sql: canonical(row.sql) }));
  const fixture = read(process.argv[2]);
  const production = read(process.argv[3]);
  if (JSON.stringify(fixture) !== JSON.stringify(production)) {
    console.error("production schema drifted from the reviewed baseline; aborting migration", { fixture, production });
    process.exit(1);
  }
' "$fixture_state/schema.json" "$remote_json"

echo "Production drift gate OK: live D1 matches the reviewed baseline"
