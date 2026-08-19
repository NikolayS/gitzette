#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "evaluate-samorev-gate-status.sh must be executed by path, not sourced or piped to Bash" >&2
  if [[ -n "${BASH_SOURCE[0]:-}" ]]; then return 1; fi
  exit 1
fi
set -euo pipefail

statuses="$(cat)"
if ! status="$(jq -ce '
  if type != "array" then error("expected an array") else . end
  | if length > 0 and (.[0] | type) == "array" then add else . end
  | map(select(.context == "samorev-gate"))
  | sort_by(.created_at // "", .id // 0)
  | last // {}
' <<<"$statuses")"; then
  echo "samorev-gate status response is malformed" >&2
  exit 4
fi

state="$(jq -r '.state // empty' <<<"$status")"
creator_id="$(jq -r '.creator.id // empty' <<<"$status")"
actions_bot_id="41898282"
if [[ -n "$state" && "$creator_id" != "$actions_bot_id" ]]; then
  echo "samorev-gate status has unexpected creator: $creator_id" >&2
  exit 3
fi
case "$state" in
  success)
    exit 0
    ;;
  failure|error)
    exit 1
    ;;
  ""|pending)
    exit 2
    ;;
  *)
    echo "samorev-gate status has unexpected state: $state" >&2
    exit 3
    ;;
esac
