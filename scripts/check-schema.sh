#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=scripts/require-wrangler.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/require-wrangler.sh"
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

bun -e 'const fs=require("fs"); const normalize=p=>JSON.parse(fs.readFileSync(p,"utf8"))[0].results.map(x=>({type:x.type,name:x.name,sql:String(x.sql).replace(/\s+/g," ")})); const a=normalize(process.argv[2]); const b=normalize(process.argv[3]); if(JSON.stringify(a)!==JSON.stringify(b)){console.error("schema.sql differs from migrations",{migrations:a,schema:b});process.exit(1)}' "$migration_state/schema.json" "$schema_state/schema.json"

echo "Schema OK: schema.sql matches the complete migration chain"
