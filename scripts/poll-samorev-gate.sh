#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "poll-samorev-gate.sh must be executed by path, not sourced or piped to Bash" >&2
  exit 1
fi
set -euo pipefail

: "${HEAD_SHA:?HEAD_SHA is required}"
: "${REPOSITORY:?REPOSITORY is required}"
: "${SAMOREV_NOT_BEFORE:?SAMOREV_NOT_BEFORE is required}"
root="$(CDPATH='' cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null && pwd)"
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
for attempt in $(seq 1 "$max_attempts"); do
  echo "samorev verdict poll $attempt/$max_attempts"
  if ! statuses="$(fetch_statuses "$attempt")"; then
    api_failures=$((api_failures + 1))
    malformed_failures=0
    if [[ "$api_failures" -ge 3 ]]; then
      publish_terminal error "GitHub status API failed three consecutive times"
      exit 1
    fi
    [[ "$attempt" -eq "$max_attempts" ]] || pause
    continue
  fi

  api_failures=0
  verdict_rc=0
  SAMOREV_NOT_BEFORE="$SAMOREV_NOT_BEFORE" bash "$root/scripts/evaluate-samorev-status.sh" <<<"$statuses" || verdict_rc=$?
  case "$verdict_rc" in
    0)
      publish_terminal success "Identity-checked samorev verdict passed"
      exit 0
      ;;
    1|3)
      publish_terminal failure "samorev verdict failed identity or outcome validation"
      exit 1
      ;;
    2)
      malformed_failures=0
      ;;
    4)
      malformed_failures=$((malformed_failures + 1))
      if [[ "$malformed_failures" -ge 3 ]]; then
        publish_terminal error "samorev status response was malformed three times"
        exit 1
      fi
      ;;
    *)
      publish_terminal error "samorev verdict evaluator failed unexpectedly"
      exit 1
      ;;
  esac
  [[ "$attempt" -eq "$max_attempts" ]] || pause
done

publish_terminal failure "samorev did not finish within the polling window"
exit 1
