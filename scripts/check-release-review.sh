#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "check-release-review.sh must be executed by path, not sourced or piped to Bash" >&2
  if [[ -n "${BASH_SOURCE[0]:-}" ]]; then return 1; fi
  exit 1
fi
set -euo pipefail

root="$(CDPATH='' cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null && pwd)"
: "${GH_TOKEN:?GH_TOKEN is required}"
: "${RELEASE_SENDER_ID:?RELEASE_SENDER_ID is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${GITHUB_REF_TYPE:?GITHUB_REF_TYPE is required}"
: "${GITHUB_REF_NAME:?GITHUB_REF_NAME is required}"
if [[ "$RELEASE_SENDER_ID" != 280144521 ]]; then
  echo "release tag must be pushed by immutable release-runner ID 280144521" >&2
  exit 1
fi
if [[ "$GITHUB_REF_TYPE" != tag || ! "$GITHUB_REF_NAME" =~ ^v[^/]*$ ]]; then
  echo "release review requires a v* tag" >&2
  exit 1
fi

main_sha="$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq .object.sha)"
pulls="$(gh api --paginate --slurp -H 'Accept: application/vnd.github+json' "repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA/pulls?per_page=100")"
reviewed_sha="$(jq -er --arg sha "$GITHUB_SHA" 'map(.[]) | map(select(.base.ref == "main" and .merged_at != null and .merge_commit_sha == $sha)) | .[0].head.sha' <<<"$pulls")"
check_run_pages="$(gh api --paginate --slurp "repos/$GITHUB_REPOSITORY/commits/$reviewed_sha/check-runs?filter=latest&per_page=100")"
status_pages="$(gh api --paginate --slurp "repos/$GITHUB_REPOSITORY/commits/$reviewed_sha/statuses?per_page=100")"

review_document="$(mktemp)"
trap 'rm -f "$review_document"' EXIT
jq -n \
  --arg release_sha "$GITHUB_SHA" \
  --arg main_sha "$main_sha" \
  --argjson pulls "$pulls" \
  --argjson check_run_pages "$check_run_pages" \
  --argjson status_pages "$status_pages" \
  '{release_sha:$release_sha,main_sha:$main_sha,pulls:$pulls,check_run_pages:$check_run_pages,status_pages:$status_pages}' \
  >"$review_document"

bun "$root/scripts/check-release-review.ts" "$review_document"
