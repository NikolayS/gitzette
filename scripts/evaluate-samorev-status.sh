#!/usr/bin/env bash
set -euo pipefail

# NikolayS; verified with: gh api users/NikolayS --jq .id
reviewer_id="1345402"
statuses="$(cat)"
if ! status="$(jq -ce '
  if type != "array" then error("expected an array") else . end
  | if length > 0 and (.[0] | type) == "array" then add else . end
  | map(select(.context == "samorev"))
  | sort_by(.created_at // "", .id // 0)
  | last // {}
' <<<"$statuses")"; then
  echo "samorev status response is malformed" >&2
  exit 4
fi
state="$(jq -r '.state // empty' <<<"$status")"
creator_id="$(jq -r '.creator.id // empty' <<<"$status")"
creator="$(jq -r '.creator.login // empty' <<<"$status")"

if [[ -z "$state" || "$state" == pending ]]; then
  exit 2
fi
if [[ -z "$creator_id" || "$creator_id" != "$reviewer_id" ]]; then
  echo "samorev status has unexpected creator: $creator ($creator_id)" >&2
  exit 3
fi
if [[ "$state" == success ]]; then
  echo "samorev passed by $creator ($creator_id)"
  exit 0
fi
if [[ "$state" == failure || "$state" == error ]]; then
  echo "samorev reported $state" >&2
  exit 1
fi
echo "samorev status has unexpected state: $state" >&2
exit 3
