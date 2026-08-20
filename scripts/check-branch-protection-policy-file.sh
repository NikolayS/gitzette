#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  echo "usage: $0 POLICY_FILE" >&2
  exit 2
fi

policy="$1"
if [[ "$(jq '.repository_rulesets | length' "$policy")" -ne 2 ]]; then
  echo "branch policy must define exactly the main and release-tag rulesets" >&2
  exit 1
fi
