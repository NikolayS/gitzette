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
    if [[ "$*" == *'--method PATCH'* ]]; then
      # A real `gh api --input -` drains stdin even with --silent. If this
      # double exits before reading, the producer can receive SIGPIPE and make
      # the apply script fail nondeterministically under `set -o pipefail`.
      cat >/dev/null
    elif [[ "$*" == *'--jq .allow_auto_merge'* ]]; then
      printf 'false\n'
    else
      printf 'User\n'
    fi
    ;;
  *rulesets\?includes_parents=false*)
    if [[ "$mode" == nonadmin-zero ]]; then
      printf '[[]]\n'
    elif [[ "$mode" == nonadmin-multiple ]]; then
      printf '[[{"id":42,"name":"main-admin-only-updates"},{"id":43,"name":"main-admin-only-updates"}]]\n'
    elif [[ "${GH_TOKEN:-}" == fake-samo-token ]]; then
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
  *rulesets\?includes_parents=true*)
    printf '[[{"id":42,"name":"main-admin-only-updates","_links":{"self":{"href":"repos/example/gitzette/rulesets/42"}}}]]\n'
    ;;
  *collaborators/samo-agent/permission)
    actor_id=280144521
    permission=push
    [[ "$mode" != nonadmin-wrong-id ]] || actor_id=1
    [[ "$mode" != nonadmin-admin ]] || permission=admin
    jq -nc --argjson actor_id "$actor_id" --arg permission "$permission" \
      '{user:{id:$actor_id},permission:$permission}'
    ;;
  repos/example/gitzette/actions/permissions/workflow)
    if [[ "$*" == *'--method PUT'* ]]; then
      printf '%s\n' "$*" >>"$record.classic"
      cat >/dev/null
    else
      jq -c '.actions_workflow_permissions' "$FAKE_POLICY"
    fi
    ;;
  repos/example/gitzette/branches/main/protection)
    if [[ "$*" == *'--method PUT'* ]]; then
      printf '%s\n' "$*" >>"$record.classic"
      cat >/dev/null
    else
      jq -c '{
        required_status_checks,
        enforce_admins:{enabled:.enforce_admins},
        required_pull_request_reviews,
        required_conversation_resolution:{enabled:.required_conversation_resolution},
        allow_force_pushes:{enabled:.allow_force_pushes},
        allow_deletions:{enabled:.allow_deletions},
        required_linear_history:{enabled:.required_linear_history},
        required_signatures:{enabled:.required_signatures},
        lock_branch:{enabled:.lock_branch},
        block_creations:{enabled:.block_creations},
        restrictions
      }' "$FAKE_POLICY"
    fi
    ;;
  repos/example/gitzette/branches/main/protection/required_status_checks)
    printf '%s\n' "$*" >>"$record.classic"
    cat >/dev/null
    ;;
  repos/example/gitzette/branches/main/protection/required_signatures)
    printf '%s\n' "$*" >>"$record.classic"
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

run_nonadmin_failure() {
  mode="$1"
  record="$test_dir/$mode"
  if GH_TOKEN=fake-samo-token GITHUB_REPOSITORY=example/gitzette FAKE_MODE="$mode" \
    FAKE_RECORD="$record" FAKE_POLICY="$root/config/main-branch-protection.json" \
    PATH="$test_dir:$PATH" bash "$root/scripts/check-branch-protection-nonadmin.sh" \
    >"$record.out" 2>"$record.err"; then
    echo "$mode unexpectedly passed the non-admin boundary" >&2
    exit 1
  fi
}
for mode in nonadmin-admin nonadmin-wrong-id nonadmin-zero nonadmin-multiple; do
  run_nonadmin_failure "$mode"
done

success_record="$test_dir/success"
GITHUB_REPOSITORY=example/gitzette FAKE_MODE=success FAKE_RECORD="$success_record" \
  FAKE_POLICY="$root/config/main-branch-protection.json" PATH="$test_dir:$PATH" \
  bash "$root/scripts/apply-branch-protection.sh" >"$success_record.out" 2>"$success_record.err"
expected_classic=(
  '--method PUT repos/example/gitzette/actions/permissions/workflow'
  '--method PUT repos/example/gitzette/branches/main/protection'
  '--method PATCH repos/example/gitzette/branches/main/protection/required_status_checks'
  '--method DELETE repos/example/gitzette/branches/main/protection/required_signatures'
)
previous_line=0
for pattern in "${expected_classic[@]}"; do
  line="$(grep -n -- "$pattern" "$success_record.classic" | cut -d: -f1)"
  [[ -n "$line" && "$line" -gt "$previous_line" ]] || {
    echo "success path did not apply classic controls in order: $pattern" >&2
    exit 1
  }
  previous_line="$line"
done

echo "branch-protection apply success, ordering, and failure tests passed"
