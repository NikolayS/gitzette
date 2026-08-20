#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT
export HEAD_SHA=0123456789012345678901234567890123456789
export REPOSITORY=NikolayS/gitzette
export SAMOREV_NOT_BEFORE=2026-08-16T00:00:00Z
export SAMOREV_SLEEP_SECONDS=0
export SAMOREV_PUBLISH_LOG="$test_dir/published"
export GITHUB_SERVER_URL=https://github.com
export GITHUB_REPOSITORY=NikolayS/gitzette
export GITHUB_RUN_ID=7

grep -q 'publish_terminal error "samorev verdict evaluator is misconfigured"' \
  "$root/scripts/poll-samorev-gate.sh" || {
  echo "poller does not map evaluator configuration errors to terminal error" >&2
  exit 1
}

for required in GITHUB_SERVER_URL GITHUB_REPOSITORY GITHUB_RUN_ID; do
  missing_error="$test_dir/missing-$required.err"
  if env -u "$required" bash "$root/scripts/poll-samorev-gate.sh" \
    >/dev/null 2>"$missing_error"; then
    echo "$required unexpectedly passed while missing" >&2
    exit 1
  fi
  grep -q "$required is required" "$missing_error" || {
    echo "$required did not produce its explicit diagnostic" >&2
    exit 1
  }
done

repository_mismatch_error="$test_dir/repository-mismatch.err"
if GITHUB_REPOSITORY=example/gitzette bash "$root/scripts/poll-samorev-gate.sh" \
  >/dev/null 2>"$repository_mismatch_error"; then
  echo "repository mismatch unexpectedly passed" >&2
  exit 1
fi
grep -q 'REPOSITORY and GITHUB_REPOSITORY must name the same repository' \
  "$repository_mismatch_error" || {
  echo "repository mismatch did not produce its explicit diagnostic" >&2
  exit 1
}

run_case() {
  name="$1"
  expected_rc="$2"
  expected_terminal="$3"
  fixture="$test_dir/$name.fixture"
  shift 3
  printf '%s\n' "$@" >"$fixture"
  : >"$SAMOREV_PUBLISH_LOG"
  actual_rc=0
  SAMOREV_FETCH_FIXTURE="$fixture" SAMOREV_MAX_ATTEMPTS="$#" \
    bash "$root/scripts/poll-samorev-gate.sh" >/dev/null 2>&1 || actual_rc=$?
  [[ "$actual_rc" == "$expected_rc" ]] || { echo "$name returned $actual_rc, expected $expected_rc" >&2; exit 1; }
  [[ "$(tail -1 "$SAMOREV_PUBLISH_LOG")" == "$expected_terminal" ]] || { echo "$name published the wrong terminal status" >&2; exit 1; }
}

pending='[[{"context":"samorev","state":"pending","created_at":"2026-08-16T00:01:00Z","target_url":"https://github.com/NikolayS/gitzette/actions/runs/7","creator":{"id":280144521,"login":"samo-agent"}}]]'
success='[[{"context":"samorev","state":"success","created_at":"2026-08-16T00:01:00Z","target_url":"https://github.com/NikolayS/gitzette/actions/runs/7","creator":{"id":280144521,"login":"samo-agent"}}]]'
wrong_target='[[{"context":"samorev","state":"success","created_at":"2026-08-16T00:01:00Z","target_url":"https://github.com/NikolayS/gitzette/actions/runs/6","creator":{"id":280144521,"login":"samo-agent"}}]]'
run_case transport 1 'error|GitHub status API failed three consecutive times' __FAIL__ __FAIL__ __FAIL__
run_case malformed 1 'error|samorev status response was malformed three times' not-json not-json not-json
run_case interleaved 0 'success|immutable-reviewer samorev verdict passed' __FAIL__ "$pending" __FAIL__ "$success"
run_case superseded-publisher 0 'success|immutable-reviewer samorev verdict passed' "$wrong_target" "$success"
run_case wrong-target-exhausted 1 'failure|latest samorev verdict targeted a different publisher run' "$wrong_target" "$wrong_target"
run_case wrong-target-then-malformed 1 'failure|latest samorev status response was malformed' "$wrong_target" not-json
run_case wrong-target-then-api-failure 1 'failure|latest GitHub status API request failed' "$wrong_target" __FAIL__
run_case exhausted 1 'failure|samorev did not finish within the polling window' "$pending" "$pending"

: >"$SAMOREV_PUBLISH_LOG"
actual_rc=0
IS_DRAFT=true SAMOREV_FETCH_FIXTURE=/dev/null SAMOREV_MAX_ATTEMPTS=1 \
  bash "$root/scripts/poll-samorev-gate.sh" >/dev/null 2>&1 || actual_rc=$?
[[ "$actual_rc" == 1 && "$(tail -1 "$SAMOREV_PUBLISH_LOG")" == 'failure|Draft PRs are not eligible for review' ]] || {
  echo "draft short-circuit failed" >&2
  exit 1
}

echo "samorev gate polling tests passed"
