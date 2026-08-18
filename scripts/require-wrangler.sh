#!/usr/bin/env bash

readonly wrangler_bin="./node_modules/.bin/wrangler"
if [[ ! -x "$wrangler_bin" ]]; then
  echo "lockfile-installed Wrangler is required; run bun install --frozen-lockfile" >&2
  exit 1
fi

local_wrangler() {
  env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID -u CLOUDFLARE_D1_TOKEN \
    "$wrangler_bin" "$@"
}
