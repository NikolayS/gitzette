#!/usr/bin/env bash

gitzette_repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
wrangler_expected_bin="$gitzette_repo_root/node_modules/.bin/wrangler"
if [[ -n "${wrangler_bin+set}" && "$wrangler_bin" != "$wrangler_expected_bin" ]]; then
  echo "wrangler_bin is already set to an unexpected path" >&2
  exit 1
fi
if [[ -z "${wrangler_bin+set}" ]]; then
  readonly wrangler_bin="$wrangler_expected_bin"
fi
unset wrangler_expected_bin
if [[ ! -x "$wrangler_bin" ]]; then
  echo "lockfile-installed Wrangler is required; run bun install --frozen-lockfile" >&2
  exit 1
fi
cd -- "$gitzette_repo_root" || exit 1
unset gitzette_repo_root

local_wrangler() (
  gitzette_require_local
  exec "$wrangler_bin" "$@"
)

gitzette_require_local() {
  unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_D1_TOKEN
  unset CLOUDFLARE_EMAIL CLOUDFLARE_API_KEY CF_API_TOKEN CF_ACCOUNT_ID
}
