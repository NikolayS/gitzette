#!/usr/bin/env bash

wrangler_expected_bin="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)/node_modules/.bin/wrangler"
if [[ -v wrangler_bin && "$wrangler_bin" != "$wrangler_expected_bin" ]]; then
  echo "wrangler_bin is already set to an unexpected path" >&2
  exit 1
fi
if [[ ! -v wrangler_bin ]]; then
  readonly wrangler_bin="$wrangler_expected_bin"
fi
unset wrangler_expected_bin
if [[ ! -x "$wrangler_bin" ]]; then
  echo "lockfile-installed Wrangler is required; run bun install --frozen-lockfile" >&2
  exit 1
fi

local_wrangler() {
  env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID -u CLOUDFLARE_D1_TOKEN \
    "$wrangler_bin" "$@"
}
