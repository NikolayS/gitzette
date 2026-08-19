#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "check-release-review-evidence.sh must be executed by path, not sourced or piped to Bash" >&2
  if [[ -n "${BASH_SOURCE[0]:-}" ]]; then return 1; fi
  exit 1
fi
set -euo pipefail

if [[ "$#" -ne 1 || ! "$1" =~ ^[0-9a-f]{40}$ ]]; then
  echo "usage: $0 REVIEWED_HEAD_SHA" >&2
  exit 2
fi
repository="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
reviewed_sha="$1"

ci_runs="$(gh api "repos/$repository/actions/workflows/ci.yml/runs?event=pull_request&head_sha=$reviewed_sha&per_page=100")"
if ! jq -e --arg sha "$reviewed_sha" '
  [.workflow_runs[] | select(.path == ".github/workflows/ci.yml" and
    .event == "pull_request" and .head_sha == $sha)] |
  sort_by(.created_at, .id) | last | .conclusion == "success"
' <<<"$ci_runs" >/dev/null; then
  echo "reviewed head lacks a successful exact-path CI run" >&2
  exit 1
fi

gate_runs="$(gh api "repos/$repository/actions/workflows/samorev-gate.yml/runs?event=pull_request_target&head_sha=$reviewed_sha&per_page=100")"
if ! jq -e --arg sha "$reviewed_sha" '
  [.workflow_runs[] | select(.path == ".github/workflows/samorev-gate.yml" and
    .event == "pull_request_target" and .head_sha == $sha)] |
  sort_by(.created_at, .id) | last | .conclusion == "success"
' <<<"$gate_runs" >/dev/null; then
  echo "reviewed head lacks a successful latest base-controlled publisher run" >&2
  exit 1
fi

statuses="$(gh api "repos/$repository/commits/$reviewed_sha/statuses?per_page=100")"
if ! jq -e '
  [.[] | select(.context == "samorev")] |
  sort_by(.created_at, .id) | last |
  .state == "success" and .creator.id == 280144521
' <<<"$statuses" >/dev/null; then
  echo "reviewed head lacks the latest immutable-reviewer samorev verdict" >&2
  exit 1
fi

echo "Release review evidence OK: exact-path CI and publisher plus immutable-reviewer verdict"
