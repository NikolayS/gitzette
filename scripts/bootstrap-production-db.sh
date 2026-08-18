#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=scripts/require-wrangler.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/require-wrangler.sh"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN is required for production bootstrap" >&2
  exit 1
fi

remote_json="$(mktemp)"
cleanup() {
  rm -f "$remote_json"
}
trap cleanup EXIT

query="SELECT COUNT(*) AS total FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"
"$wrangler_bin" d1 execute gitzette-db --remote --command "$query" --json >"$remote_json"
table_count="$(jq -er '.[0].results[0].total | select(type == "number")' "$remote_json")"
if [[ "$table_count" -ne 0 ]]; then
  echo "production bootstrap requires a brand-new empty D1 database; found $table_count application tables" >&2
  exit 1
fi

"$wrangler_bin" d1 migrations apply gitzette-db --remote
bash scripts/check-production-schema.sh
echo "Production bootstrap OK: empty D1 now matches the complete reviewed migration chain"
