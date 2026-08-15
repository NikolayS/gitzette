#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN is required to verify Worker secrets" >&2
  exit 1
fi

secret_json="$(mktemp)"
trap 'rm -f "$secret_json"' EXIT
bunx wrangler secret list --format json >"$secret_json"
bun -e '
  const secrets = JSON.parse(await Bun.file(process.argv[2]).text());
  if (!Array.isArray(secrets)) throw new Error("invalid Wrangler secret list");
  const configured = new Set(secrets.map(secret => secret.name));
  const required = ["GITHUB_CLIENT_SECRET", "SESSION_SECRET", "STATUS_TOKEN", "RUNNER_SECRET"];
  const missing = required.filter(name => !configured.has(name));
  if (missing.length) throw new Error(`missing production Worker secrets: ${missing.join(", ")}`);
' "$secret_json"

echo "Production secrets OK: all required Worker bindings exist"
