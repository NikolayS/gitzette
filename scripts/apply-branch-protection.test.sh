#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT
cat >"$test_dir/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
mode="${FAKE_MODE:?}"
record="${FAKE_RECORD:?}"
if [[ "${1:-}" == auth ]]; then
  printf 'fake-samo-token\n'
  exit 0
fi
endpoint=''
for argument in "$@"; do
  [[ "$argument" == repos/* || "$argument" == https://api.github.com/repos/* ]] && endpoint="$argument"
done
case "$endpoint" in
  repos/example/gitzette)
    printf 'User\n'
    ;;
  *rulesets\?includes_parents=false*)
    if [[ "${GH_TOKEN:-}" == fake-samo-token ]]; then
      printf '[[{"id":42,"name":"main-admin-only-updates"}]]\n'
    elif [[ "$mode" == multiple ]]; then
      printf '[[{"id":42,"name":"main-admin-only-updates"},{"id":43,"name":"main-admin-only-updates"}]]\n'
    elif [[ "$mode" == one ]]; then
      printf '[[{"id":42,"name":"main-admin-only-updates"}]]\n'
    else
      printf '[[]]\n'
    fi
    ;;
  repos/example/gitzette/rulesets|repos/example/gitzette/rulesets/42)
    if [[ "$*" == *'--method POST'* || "$*" == *'--method PUT'* ]]; then
      printf '%s\n' "$*" >>"$record.mutations"
      cat >/dev/null
      printf '{"id":42}\n'
    else
      current=always
      [[ "${GH_TOKEN:-}" != fake-samo-token ]] || current=never
      [[ "$mode" != admin-never ]] || current=never
      if [[ "$mode" == nonadmin-bypass || "$mode" == zero || "$mode" == one ]]; then
        [[ "${GH_TOKEN:-}" != fake-samo-token ]] || current=always
      fi
      jq -c --arg current "$current" '.repository_rulesets[0] + {id:42,current_user_can_bypass:$current}' "$FAKE_POLICY" |
        if [[ "$mode" == mismatch && "${GH_TOKEN:-}" != fake-samo-token ]]; then jq -c '.name="wrong"'; else cat; fi
    fi
    ;;
  *collaborators/samo-agent/permission)
    printf '{"user":{"id":280144521},"permission":"push"}\n'
    ;;
  *)
    printf '%s\n' "$*" >>"$record.classic"
    exit 90
    ;;
esac
EOF
chmod +x "$test_dir/gh"

assert_file_contains() {
  file="$1"
  pattern="$2"
  if [[ ! -f "$file" ]] || ! grep -q -- "$pattern" "$file"; then
    echo "$file does not contain $pattern" >&2
    [[ ! -f "$file" ]] || sed 's/^/  /' "$file" >&2
    exit 1
  fi
}

run_failure() {
  mode="$1"
  record="$test_dir/$mode"
  if GITHUB_REPOSITORY=example/gitzette FAKE_MODE="$mode" FAKE_RECORD="$record" \
    FAKE_POLICY="$root/config/main-branch-protection.json" PATH="$test_dir:$PATH" \
    bash "$root/scripts/apply-branch-protection.sh" >"$record.out" 2>"$record.err"; then
    echo "$mode unexpectedly applied" >&2
    exit 1
  fi
  [[ "${TEST_DEBUG:-false}" != true ]] || sed "s/^/$mode: /" "$record.err" >&2
  [[ ! -e "$record.classic" ]] || { echo "$mode reached classic protection before the ruleset boundary passed" >&2; exit 1; }
}

run_failure zero
assert_file_contains "$test_dir/zero.mutations" '--method POST repos/example/gitzette/rulesets'
run_failure one
assert_file_contains "$test_dir/one.mutations" '--method PUT repos/example/gitzette/rulesets/42'
run_failure multiple
[[ ! -e "$test_dir/multiple.mutations" ]]
run_failure admin-never
run_failure mismatch
run_failure nonadmin-bypass
assert_file_contains "$test_dir/nonadmin-bypass.err" 'samo-agent can bypass'

echo "branch-protection apply ordering and failure tests passed"
