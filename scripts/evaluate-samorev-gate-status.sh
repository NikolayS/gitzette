#!/usr/bin/env bash
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
