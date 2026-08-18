#!/usr/bin/env bash
set -euo pipefail
source scripts/require-wrangler.sh

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN is required to verify Worker secrets" >&2
  exit 1
fi

secret_json="$(mktemp)"
trap 'rm -f "$secret_json"' EXIT
"$wrangler_bin" secret list --format json >"$secret_json"
# The Bun program intentionally receives shell values through argv.
# shellcheck disable=SC2016
bun -e '
  const secrets = JSON.parse(await Bun.file(process.argv[2]).text());
  if (!Array.isArray(secrets)) throw new Error("invalid Wrangler secret list");
  const configured = secrets.map(secret => secret.name).sort();
  const expected = ["ADMIN_USER_ID", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "RUNNER_SECRET", "SESSION_SECRET", "STATUS_TOKEN"].sort();
  const missing = expected.filter(name => !configured.includes(name));
  const retired = configured.filter(name => !expected.includes(name));
  if (missing.length || retired.length) {
    throw new Error(`production Worker secret mismatch; missing=[${missing.join(", ")}], retired-or-unknown=[${retired.join(", ")}]`);
  }
' "$secret_json"

echo "Production secrets OK: required bindings exist and retired provider credentials are absent"
