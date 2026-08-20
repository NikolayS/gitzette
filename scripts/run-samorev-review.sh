#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "run-samorev-review.sh must be executed by path, not sourced or piped to Bash" >&2
  if [[ -n "${BASH_SOURCE[0]:-}" ]]; then return 1; fi
  exit 1
fi
set -euo pipefail

if [[ "$#" -ne 3 || ! "$1" =~ ^[0-9]+$ || ! "$2" =~ ^[0-9]+$ || ! "$3" =~ ^[0-9]+$ ]]; then
  echo "usage: $0 PR_NUMBER PUBLISHER_RUN_ID PUBLISHER_CHECK_RUN_ID" >&2
  exit 2
fi
: "${GH_TOKEN:?GH_TOKEN must be the samo-agent token}"
: "${SAMOREV_HOME:?SAMOREV_HOME is required}"

repository="${GITHUB_REPOSITORY:-NikolayS/gitzette}"
pr_number="$1"
publisher_run_id="$2"
publisher_check_run_id="$3"
reviewer_sha=1397e9762c3f7b0f6230260ca4960241dfb38bf2
if [[ "$(git -C "$SAMOREV_HOME" rev-parse HEAD)" != "$reviewer_sha" ]]; then
  echo "samorev must be checked out at $reviewer_sha" >&2
  exit 1
fi
if [[ -n "$(git -C "$SAMOREV_HOME" status --porcelain --untracked-files=all)" ]]; then
  echo "samorev checkout must be clean at $reviewer_sha" >&2
  exit 1
fi

pr="$(gh pr view "$pr_number" --repo "$repository" --json headRefOid,url)"
head_sha="$(jq -er .headRefOid <<<"$pr")"
pr_url="$(jq -er .url <<<"$pr")"
publisher_run="$(gh api "repos/$repository/actions/runs/$publisher_run_id")"
publisher_url="$(jq -er .html_url <<<"$publisher_run")"
if ! jq -e --arg head_sha "$head_sha" --arg repository "$repository" --argjson pr "$pr_number" '
  .head_sha == $head_sha and .path == ".github/workflows/samorev-gate.yml" and
  .event == "pull_request_target" and .head_repository.full_name == $repository and
  any(.pull_requests[]; .number == $pr and .base.ref == "main" and .head.sha == $head_sha)
' <<<"$publisher_run" >/dev/null; then
  echo "publisher run is not the protected-base exact-head samorev workflow" >&2
  exit 1
fi
publisher="$(gh run view "$publisher_run_id" --repo "$repository" --json jobs)"
jq -e --argjson id "$publisher_check_run_id" '
  any(.jobs[]; .databaseId == $id and .name == "base-controlled samorev publisher")
' <<<"$publisher" >/dev/null || {
  echo "publisher check ID does not identify the protected-base publisher job" >&2
  exit 1
}

publish() {
  gh api --method POST "repos/$repository/statuses/$head_sha" \
    -f state="$1" -f context=samorev -f description="$2" \
    -f target_url="$publisher_url" >/dev/null
}

terminal_published=false
# shellcheck disable=SC2317 # invoked by the EXIT trap
cleanup() {
  rc=$?
  if [[ "$terminal_published" != true ]]; then
    publish error "samorev reviewer terminated without a terminal verdict" || true
  fi
  exit "$rc"
}
trap cleanup EXIT

publish pending "samo-agent is reviewing the exact PR head"
log_file="$(mktemp)"
review_rc=0
SAMOREV_IGNORED_GITHUB_CHECK_RUN_IDS="$publisher_check_run_id" \
SAMOREV_IGNORED_GITHUB_CHECK_NAME="base-controlled samorev publisher" \
SAMOREV_IGNORED_GITHUB_CHECK_APP_ID=15368 \
  bun "$SAMOREV_HOME/src/cli.ts" review "$pr_url" --blocking --fetch \
  >"$log_file" 2>&1 || review_rc=$?
cat "$log_file"

if [[ "$review_rc" -eq 0 ]]; then
  publish success "terminal-clean exact-head samorev passed"
elif grep -q '^## samorev Code Review Report' "$log_file"; then
  publish failure "samorev reported blocking findings"
else
  publish error "samorev reviewer failed before producing a report"
fi
terminal_published=true
rm -f "$log_file"
trap - EXIT
exit "$review_rc"
