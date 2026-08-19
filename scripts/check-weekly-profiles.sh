#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=scripts/require-wrangler.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/require-wrangler.sh"
gitzette_require_checked_in_caller \
  "check-weekly-profiles.sh" "${BASH_SOURCE[0]:-}" "$0" "check-weekly-profiles.ts"

weekly_enabled="$(bun -e '
  const config = Bun.TOML.parse(await Bun.file("wrangler.toml").text());
  const value = config.vars?.WEEKLY_GENERATION_ENABLED;
  if (value !== "true" && value !== "false") throw new Error("invalid WEEKLY_GENERATION_ENABLED");
  process.stdout.write(value);
')"
if [[ "$weekly_enabled" == "false" ]]; then
  echo "Weekly profile preflight skipped: weekly generation is disabled"
  exit 0
fi
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN is required to verify weekly profiles" >&2
  exit 1
fi

users_json="$(mktemp)"
trap 'rm -f "$users_json"' EXIT
"$wrangler_bin" d1 execute gitzette-db --remote \
  --command "SELECT username FROM users ORDER BY username COLLATE NOCASE" \
  --json >"$users_json"
bun "$gitzette_scripts_directory/check-weekly-profiles.ts" "$users_json"
