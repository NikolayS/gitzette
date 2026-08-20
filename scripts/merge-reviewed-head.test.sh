#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "merge-reviewed-head.test.sh must be executed by path, not sourced or piped to Bash" >&2
  if [[ -n "${BASH_SOURCE[0]:-}" ]]; then return 1; fi
  exit 1
fi
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT
mkdir -p "$test_dir/repo/scripts" "$test_dir/bin"
cp "$root/scripts/merge-reviewed-head.sh" "$test_dir/repo/scripts/"

for check in check-release-review-evidence.sh check-branch-protection.sh check-branch-protection-nonadmin.sh; do
  cat >"$test_dir/repo/scripts/$check" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$(basename "$0")" >>"${FAKE_RECORD:?}"
[[ "${FAKE_MODE:-success}" != audit-fail || "$(basename "$0")" != check-branch-protection.sh ]]
EOF
done

cat >"$test_dir/bin/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  *'status --porcelain --untracked-files=all'*)
    [[ "${FAKE_MODE:-success}" != dirty ]] || printf ' M dirty\n'
    ;;
  *'rev-parse HEAD'*) printf 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n' ;;
  *) exit 91 ;;
esac
EOF

cat >"$test_dir/bin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
mode="${FAKE_MODE:-success}"
if [[ "${1:-}" == api && "${2:-}" == user ]]; then
  if [[ -n "${GH_TOKEN:-}" ]]; then
    [[ "$mode" != wrong-token ]] || { printf '1\n'; exit 0; }
    printf '280144521\n'
  else
    printf '1345402\n'
  fi
  exit 0
fi
if [[ "${1:-}" == auth && "${2:-}" == token ]]; then
  printf 'fake-samo-token\n'
  exit 0
fi
if [[ "${1:-}" == pr && "${2:-}" == view ]]; then
  if [[ "$*" == *'--jq .headRefOid'* ]]; then
    [[ "$mode" != head-change ]] || { printf 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n'; exit 0; }
    printf 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n'
  else
    jq -nc '{headRefOid:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",state:"OPEN",baseRefName:"main",headRepository:{nameWithOwner:"example/gitzette"}}'
  fi
  exit 0
fi
if [[ "${1:-}" == pr && "${2:-}" == merge ]]; then
  printf 'gh pr merge %s\n' "${*:3}" >>"${FAKE_RECORD:?}"
  exit 0
fi
exit 91
EOF
chmod +x "$test_dir/repo/scripts/"*.sh "$test_dir/bin/git" "$test_dir/bin/gh"

run_case() {
  mode="$1"
  expected_rc="$2"
  record="$test_dir/$mode.record"
  : >"$record"
  actual_rc=0
  env -u GH_TOKEN GITHUB_REPOSITORY=example/gitzette FAKE_MODE="$mode" \
    FAKE_RECORD="$record" PATH="$test_dir/bin:$PATH" \
    bash "$test_dir/repo/scripts/merge-reviewed-head.sh" 68 \
    >"$test_dir/$mode.out" 2>"$test_dir/$mode.err" || actual_rc=$?
  [[ "$actual_rc" == "$expected_rc" ]] || {
    echo "$mode returned $actual_rc, expected $expected_rc" >&2
    exit 1
  }
}

run_case success 0
expected_order=$'check-release-review-evidence.sh\ncheck-branch-protection.sh\ncheck-branch-protection-nonadmin.sh'
[[ "$(head -3 "$test_dir/success.record")" == "$expected_order" ]] || {
  echo "merge wrapper did not run evidence, admin policy, and non-admin policy in order" >&2
  exit 1
}
grep -q -- '--merge --match-head-commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
  "$test_dir/success.record" || {
  echo "merge wrapper did not bind the merge to the reviewed head" >&2
  exit 1
}

for mode in dirty audit-fail wrong-token head-change; do
  run_case "$mode" 1
  if grep -q '^gh pr merge ' "$test_dir/$mode.record"; then
    echo "$mode reached merge" >&2
    exit 1
  fi
done

echo "reviewed-head merge wrapper ordering and identity tests passed"
