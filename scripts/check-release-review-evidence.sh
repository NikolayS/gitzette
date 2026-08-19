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
ci_run="$(jq -ce --arg sha "$reviewed_sha" '
  [.workflow_runs[] | select(.path == ".github/workflows/ci.yml" and
    .event == "pull_request" and .head_sha == $sha)] |
  sort_by(.created_at, .id) | last
' <<<"$ci_runs")" || {
  echo "reviewed head lacks an exact-path CI run" >&2
  exit 1
}
if ! jq -e --arg sha "$reviewed_sha" --arg repository "$repository" '
  .conclusion == "success" and .head_repository.full_name == $repository and
  any(.pull_requests[];
    .base.ref == "main" and .base.repo.url == "https://api.github.com/repos/\($repository)" and
    .head.sha == $sha and .head.repo.url == "https://api.github.com/repos/\($repository)")
' <<<"$ci_run" >/dev/null; then
  echo "latest exact-path CI run is not successful same-repository main-base evidence" >&2
  exit 1
fi

gate_runs="$(gh api "repos/$repository/actions/workflows/samorev-gate.yml/runs?event=pull_request_target&head_sha=$reviewed_sha&per_page=100")"
gate_run="$(jq -ce --arg sha "$reviewed_sha" '
  [.workflow_runs[] | select(.path == ".github/workflows/samorev-gate.yml" and
    .event == "pull_request_target" and .head_sha == $sha)] |
  sort_by(.created_at, .id) | last
' <<<"$gate_runs")" || {
  echo "reviewed head lacks an exact-path publisher run" >&2
  exit 1
}
if ! jq -e --arg sha "$reviewed_sha" --arg repository "$repository" '
  .conclusion == "success" and .head_repository.full_name == $repository and
  any(.pull_requests[];
    .base.ref == "main" and .base.repo.url == "https://api.github.com/repos/\($repository)" and
    .head.sha == $sha and .head.repo.url == "https://api.github.com/repos/\($repository)")
' <<<"$gate_run" >/dev/null; then
  echo "latest exact-path publisher run is not successful same-repository main-base evidence" >&2
  exit 1
fi

statuses="$(gh api --paginate --slurp "repos/$repository/commits/$reviewed_sha/statuses?per_page=100" | jq -c 'add // []')"
publisher_url="$(jq -er .html_url <<<"$gate_run")"
publisher_started_at="$(jq -er .run_started_at <<<"$gate_run")"
if ! jq -e --arg publisher_url "$publisher_url" --arg publisher_started_at "$publisher_started_at" '
  [.[] | select(.context == "samorev")] |
  sort_by(.created_at, .id) | last |
  .state == "success" and .creator.id == 280144521 and
  .target_url == $publisher_url and .created_at >= $publisher_started_at
' <<<"$statuses" >/dev/null; then
  echo "reviewed head lacks a publisher-bound immutable-reviewer samorev verdict" >&2
  exit 1
fi

echo "Release review evidence OK: exact-path CI and publisher plus immutable-reviewer verdict"
