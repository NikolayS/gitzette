#!/usr/bin/env bash
set -euo pipefail

script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/evaluate-samorev-gate-status.sh"

assert_exit() {
  expected="$1"
  document="$2"
  actual=0
  "$script" <<<"$document" >/dev/null 2>&1 || actual=$?
  [[ "$actual" == "$expected" ]] || {
    echo "expected gate evaluator exit $expected, got $actual for $document" >&2
    exit 1
  }
}

assert_exit 2 '[]'
assert_exit 2 '[{"context":"samorev-gate","state":"pending","created_at":"2026-08-19T00:00:00Z","id":1,"creator":{"id":41898282}}]'
assert_exit 1 '[{"context":"samorev-gate","state":"success","created_at":"2026-08-19T00:00:00Z","id":1,"creator":{"id":41898282}},{"context":"samorev-gate","state":"failure","created_at":"2026-08-19T00:01:00Z","id":2,"creator":{"id":41898282}}]'
assert_exit 0 '[{"context":"samorev-gate","state":"failure","created_at":"2026-08-19T00:00:00Z","id":1,"creator":{"id":41898282}},{"context":"samorev-gate","state":"success","created_at":"2026-08-19T00:01:00Z","id":2,"creator":{"id":41898282}}]'
assert_exit 3 '[{"context":"samorev-gate","state":"success","created_at":"2026-08-19T00:00:00Z","id":1,"creator":{"id":1}}]'
assert_exit 3 '[{"context":"samorev-gate","state":"success","created_at":"2026-08-19T00:00:00Z","id":1}]'
assert_exit 4 'not-json'
assert_exit 4 '{}'

echo "samorev-gate status evaluator tests passed"
