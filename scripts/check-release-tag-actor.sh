#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "check-release-tag-actor.sh must be executed by path, not sourced or piped to Bash" >&2
  if [[ -n "${BASH_SOURCE[0]:-}" ]]; then return 1; fi
  exit 1
fi
set -euo pipefail

if [[ "$#" -ne 1 || "$1" != 280144521 ]]; then
  echo "release tags must be pushed by samo-agent so Nik can approve production" >&2
  exit 1
fi
echo "Release tag actor OK: immutable samo-agent ID 280144521"
