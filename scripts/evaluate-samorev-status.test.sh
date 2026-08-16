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

assert_exit 2 '[]'
assert_exit 2 '[[{"context":"samorev","state":"pending","created_at":"2026-08-16T00:00:00Z","id":1,"creator":{"id":280144521,"login":"samo-agent"}}]]'
assert_exit 0 '[{"context":"other","state":"failure","created_at":"2026-08-16T00:02:00Z","id":3},{"context":"samorev","state":"failure","created_at":"2026-08-16T00:00:00Z","id":1,"creator":{"id":280144521,"login":"samo-agent"}},{"context":"samorev","state":"success","created_at":"2026-08-16T00:01:00Z","id":2,"creator":{"id":280144521,"login":"samo-agent"}}]'
assert_exit 2 '[{"context":"samorev","state":"success","created_at":"2026-08-16T00:00:00Z","id":1,"creator":{"id":280144521,"login":"samo-agent"}},{"context":"samorev","state":"pending","created_at":"2026-08-16T00:01:00Z","id":2,"creator":{"id":280144521,"login":"samo-agent"}}]'
assert_exit 3 '[{"context":"samorev","state":"success","created_at":"2026-08-16T00:00:00Z","id":1,"creator":{"id":280144521,"login":"samo-agent"}},{"context":"samorev","state":"success","created_at":"2026-08-16T00:01:00Z","id":2,"creator":{"id":1,"login":"attacker"}}]'
assert_exit 2 '[{"context":"samorev","state":"success","created_at":"2026-08-16T00:00:00Z","id":1,"creator":{"id":280144521,"login":"samo-agent"}},{"context":"samorev","state":"pending","created_at":"2026-08-16T00:00:00Z","id":2,"creator":{"id":280144521,"login":"samo-agent"}}]'
assert_exit 0 '[[{"context":"samorev","state":"failure","created_at":"2026-08-16T00:00:00Z","id":1,"creator":{"id":280144521,"login":"samo-agent"}}],[{"context":"samorev","state":"success","created_at":"2026-08-16T00:01:00Z","id":2,"creator":{"id":280144521,"login":"samo-agent"}}]]'
assert_exit 3 '[{"context":"samorev","state":"success","creator":{"id":1,"login":"attacker"}}]'
assert_exit 3 '[{"context":"samorev","state":"success"}]'
assert_exit 1 '[{"context":"samorev","state":"failure","creator":{"id":280144521,"login":"samo-agent"}}]'
assert_exit 1 '[{"context":"samorev","state":"error","creator":{"id":280144521,"login":"samo-agent"}}]'
assert_exit 3 '[{"context":"samorev","state":"neutral","creator":{"id":280144521,"login":"samo-agent"}}]'
SAMOREV_NOT_BEFORE=2026-08-16T00:02:00Z assert_exit 2 '[{"context":"samorev","state":"success","created_at":"2026-08-16T00:01:00Z","creator":{"id":280144521,"login":"samo-agent"}}]'
SAMOREV_NOT_BEFORE=2026-08-16T00:02:00Z assert_exit 0 '[{"context":"samorev","state":"success","created_at":"2026-08-16T00:03:00Z","creator":{"id":280144521,"login":"samo-agent"}}]'
assert_exit 4 'not-json'
assert_exit 4 '{}'

echo "samorev status evaluator tests passed"
