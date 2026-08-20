#!/usr/bin/env bash
set -euo pipefail

: "${HEAD_SHA:?HEAD_SHA is required}"
: "${REPOSITORY:?REPOSITORY is required}"
: "${SAMOREV_NOT_BEFORE:?SAMOREV_NOT_BEFORE is required}"
: "${GITHUB_SERVER_URL:?GITHUB_SERVER_URL is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
if [[ "$REPOSITORY" != "$GITHUB_REPOSITORY" ]]; then
  echo "REPOSITORY and GITHUB_REPOSITORY must name the same repository" >&2
  exit 1
fi
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
samorev_target_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
max_attempts="${SAMOREV_MAX_ATTEMPTS:-60}"
sleep_seconds="${SAMOREV_SLEEP_SECONDS:-30}"

publish_gate() {
  state="$1"
  description="$2"
  if [[ -n "${SAMOREV_PUBLISH_LOG:-}" ]]; then
    printf '%s|%s\n' "$state" "$description" >>"$SAMOREV_PUBLISH_LOG"
    return
  fi
  gh api --method POST "repos/$REPOSITORY/statuses/$HEAD_SHA" \
    -f state="$state" -f context=samorev-gate \
    -f description="$description" \
    -f target_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" >/dev/null
}

publish_terminal() {
  publish_gate "$1" "$2"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "published=1" >>"$GITHUB_OUTPUT"
  fi
}

fetch_statuses() {
  attempt="$1"
  if [[ -n "${SAMOREV_FETCH_FIXTURE:-}" ]]; then
    response="$(sed -n "${attempt}p" "$SAMOREV_FETCH_FIXTURE")"
    [[ "$response" != __FAIL__ ]] || return 1
    printf '%s\n' "$response"
    return
  fi
  gh api --paginate --slurp "repos/$REPOSITORY/commits/$HEAD_SHA/statuses?per_page=100"
}

pause() {
  [[ "$sleep_seconds" == 0 ]] || sleep "$sleep_seconds"
}

publish_gate pending "Waiting for the exact-head samorev verdict"
if [[ "${IS_DRAFT:-false}" == true ]]; then
  publish_terminal failure "Draft PRs are not eligible for review"
  exit 1
fi
if [[ ! -f "$root/scripts/evaluate-samorev-status.sh" ]]; then
  publish_terminal error "Base-branch samorev evaluator is missing"
  exit 1
fi

api_failures=0
malformed_failures=0
last_non_terminal_reason=pending
for attempt in $(seq 1 "$max_attempts"); do
  echo "samorev verdict poll $attempt/$max_attempts"
  if ! statuses="$(fetch_statuses "$attempt")"; then
    api_failures=$((api_failures + 1))
    malformed_failures=0
    last_non_terminal_reason=api-failure
    if [[ "$api_failures" -ge 3 ]]; then
      publish_terminal error "GitHub status API failed three consecutive times"
      exit 1
    fi
    [[ "$attempt" -eq "$max_attempts" ]] || pause
    continue
  fi

  api_failures=0
  verdict_rc=0
  verdict_diagnostic="$(SAMOREV_NOT_BEFORE="$SAMOREV_NOT_BEFORE" \
    SAMOREV_TARGET_URL="$samorev_target_url" \
    bash "$root/scripts/evaluate-samorev-status.sh" <<<"$statuses" 2>&1)" || verdict_rc=$?
  case "$verdict_rc" in
    0)
      publish_terminal success "immutable-reviewer samorev verdict passed"
      exit 0
      ;;
    1|3)
      publish_terminal failure "samorev verdict failed identity or outcome validation"
      exit 1
      ;;
    2)
      malformed_failures=0
      if grep -q "targets the wrong publisher" <<<"$verdict_diagnostic"; then
        last_non_terminal_reason=publisher-target-mismatch
      else
        last_non_terminal_reason=pending
      fi
      ;;
    4)
      malformed_failures=$((malformed_failures + 1))
      last_non_terminal_reason=malformed
      if [[ "$malformed_failures" -ge 3 ]]; then
        publish_terminal error "samorev status response was malformed three times"
        exit 1
      fi
      ;;
    5)
      publish_terminal error "samorev verdict evaluator is misconfigured"
      exit 1
      ;;
    *)
      publish_terminal error "samorev verdict evaluator failed unexpectedly"
      exit 1
      ;;
  esac
  [[ "$attempt" -eq "$max_attempts" ]] || pause
done

case "$last_non_terminal_reason" in
  publisher-target-mismatch)
    publish_terminal failure "latest samorev verdict targeted a different publisher run"
    ;;
  malformed)
    publish_terminal failure "latest samorev status response was malformed"
    ;;
  api-failure)
    publish_terminal failure "latest GitHub status API request failed"
    ;;
  *)
    publish_terminal failure "samorev did not finish within the polling window"
    ;;
esac
exit 1
