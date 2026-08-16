#!/usr/bin/env bash
set -euo pipefail

script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/evaluate-samorev-status.sh"

assert_exit() {
  expected="$1"
  document="$2"
  actual=0
  "$script" <<<"$document" >/dev/null 2>&1 || actual=$?
  if [[ "$actual" != "$expected" ]]; then
    echo "expected evaluator exit $expected, got $actual for $document" >&2
    exit 1
  fi
}

assert_exit 2 '{}'
assert_exit 2 '{"state":"pending","creator":{"id":1345402,"login":"NikolayS"}}'
assert_exit 0 '{"state":"success","creator":{"id":1345402,"login":"NikolayS"}}'
assert_exit 3 '{"state":"success","creator":{"id":1,"login":"attacker"}}'
assert_exit 3 '{"state":"success"}'
assert_exit 1 '{"state":"failure","creator":{"id":1345402,"login":"NikolayS"}}'

echo "samorev status evaluator tests passed"
