#!/usr/bin/env bash

readonly gitzette_invocation_directory="$PWD"
gitzette_scripts_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly gitzette_scripts_directory
gitzette_repo_root="$(cd -- "$gitzette_scripts_directory/.." && pwd -P)"
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

gitzette_require_checked_in_caller() {
  local expected_name="$1"
  local caller_path="${2:-}"
  local executable_path="${3:-$0}"
  local caller_directory
  local executable_directory
  local sibling_name

  if [[ -z "$caller_path" ]]; then
    echo "$expected_name must run under Bash from its checked-in path, not through stdin" >&2
    exit 1
  fi
  if [[ "$caller_path" != */* ]]; then
    if [[ -e "$gitzette_invocation_directory/$caller_path" ]]; then
      caller_path="$gitzette_invocation_directory/$caller_path";
    else caller_path="$(type -P -- "$caller_path" || true)"; fi
  elif [[ "$caller_path" != /* ]]; then
    caller_path="$gitzette_invocation_directory/$caller_path"
  fi
  if [[ "$executable_path" != */* ]]; then
    if [[ -e "$gitzette_invocation_directory/$executable_path" ]]; then
      executable_path="$gitzette_invocation_directory/$executable_path";
    else executable_path="$(type -P -- "$executable_path" || true)"; fi
  elif [[ "$executable_path" != /* ]]; then
    executable_path="$gitzette_invocation_directory/$executable_path"
  fi
  caller_directory="$(CDPATH='' cd -P -- "$(dirname -- "$caller_path")" >/dev/null && pwd)"
  executable_directory="$(CDPATH='' cd -P -- "$(dirname -- "$executable_path")" >/dev/null && pwd)"
  if [[ "$(basename -- "$caller_path")" != "$expected_name" \
    || "$(basename -- "$executable_path")" != "$expected_name" \
    || "$caller_directory" != "$gitzette_scripts_directory" \
    || "$executable_directory" != "$gitzette_scripts_directory" ]]; then
    echo "$expected_name must be executed, not sourced or wrapped; use its checked-in path" >&2
    exit 1
  fi
  shift 3
  for sibling_name in "$@"; do
    if [[ ! -r "$gitzette_scripts_directory/$sibling_name" ]]; then
      echo "checked-in sibling is required: $gitzette_scripts_directory/$sibling_name" >&2
      exit 1
    fi
  done
}

local_wrangler() (
  gitzette_require_local
  exec "$wrangler_bin" "$@"
)

gitzette_require_local() {
  unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_D1_TOKEN
  unset CLOUDFLARE_EMAIL CLOUDFLARE_API_KEY CF_API_TOKEN CF_ACCOUNT_ID
}
