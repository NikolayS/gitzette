#!/usr/bin/env bash
set -euo pipefail

script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-pr-workflow-permissions.sh"
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT
git -C "$test_dir" init -q
git -C "$test_dir" config user.email test@example.com
git -C "$test_dir" config user.name test
mkdir -p "$test_dir/.github/workflows"
printf '%s\n' 'permissions:' '  contents: read' >"$test_dir/.github/workflows/ci.yml"
git -C "$test_dir" add .
git -C "$test_dir" commit -qm base
base_sha="$(git -C "$test_dir" rev-parse HEAD)"

printf '%s\n' 'permissions:' '  contents: read' 'jobs: {}' >"$test_dir/.github/workflows/ci.yml"
git -C "$test_dir" commit -qam safe
safe_sha="$(git -C "$test_dir" rev-parse HEAD)"
WORKFLOW_PERMISSION_SKIP_FETCH=true BASE_SHA="$base_sha" HEAD_SHA="$safe_sha" \
  bash -c 'cd "$1" && exec "$2"' _ "$test_dir" "$script" >/dev/null

printf '%s\n' 'permissions: {contents: read, statuses: write}' >"$test_dir/.github/workflows/ci.yml"
git -C "$test_dir" commit -qam privileged
privileged_sha="$(git -C "$test_dir" rev-parse HEAD)"
if WORKFLOW_PERMISSION_SKIP_FETCH=true BASE_SHA="$safe_sha" HEAD_SHA="$privileged_sha" \
  bash -c 'cd "$1" && exec "$2"' _ "$test_dir" "$script" >/dev/null 2>&1; then
  echo "privileged workflow change was accepted" >&2
  exit 1
fi

printf '%s\n' 'permissions: write-all' >"$test_dir/.github/workflows/ci.yml"
git -C "$test_dir" commit -qam write-all
write_all_sha="$(git -C "$test_dir" rev-parse HEAD)"
if WORKFLOW_PERMISSION_SKIP_FETCH=true BASE_SHA="$privileged_sha" HEAD_SHA="$write_all_sha" \
  bash -c 'cd "$1" && exec "$2"' _ "$test_dir" "$script" >/dev/null 2>&1; then
  echo "write-all workflow change was accepted" >&2
  exit 1
fi

echo "PR workflow permission tests passed"
