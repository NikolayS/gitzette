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
if [[ "$*" == 'api user --jq .id' ]]; then
  if [[ "$mode" == nonadmin-wrong-token ]]; then printf '1\n'; else printf '280144521\n'; fi
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
      printf '[[{"id":42,"name":"main-samo-only-updates"},{"id":43,"name":"main-samo-only-updates"},{"id":44,"name":"release-tags-samo-only"}]]\n'
    elif [[ "${GH_TOKEN:-}" == fake-samo-token ]]; then
      printf '[[{"id":42,"name":"main-samo-only-updates"},{"id":44,"name":"release-tags-samo-only"}]]\n'
    elif [[ "$mode" == multiple ]]; then
      printf '[[{"id":42,"name":"main-samo-only-updates"},{"id":43,"name":"main-samo-only-updates"},{"id":44,"name":"release-tags-samo-only"}]]\n'
    elif [[ "$mode" == one ]]; then
      printf '[[{"id":42,"name":"main-samo-only-updates"}]]\n'
    else
      printf '[[]]\n'
    fi
    ;;
  repos/example/gitzette/rulesets|repos/example/gitzette/rulesets/42|repos/example/gitzette/rulesets/44)
    if [[ "$*" == *'--method POST'* || "$*" == *'--method PUT'* ]]; then
      printf '%s\n' "$*" >>"$record.mutations"
      payload="$(cat)"
      id=42
      [[ "$(jq -r .name <<<"$payload")" != release-tags-samo-only ]] || id=44
      printf '{"id":%s}\n' "$id"
    else
      index=0; current=never
      [[ "$endpoint" != */44 ]] || index=1
      if [[ "${GH_TOKEN:-}" == fake-samo-token ]]; then
        current=always
        [[ "$mode" != nonadmin-main-denied || "$index" -ne 0 ]] || current=never
        [[ "$mode" != nonadmin-tag-denied || "$index" -ne 1 ]] || current=never
      fi
      [[ "$mode" != admin-bypass || "$index" -ne 0 || "${GH_TOKEN:-}" == fake-samo-token ]] || current=always
      jq -c --arg current "$current" --argjson index "$index" --argjson id "${endpoint##*/}" \
        '.repository_rulesets[$index] + {id:$id,current_user_can_bypass:$current}' "$FAKE_POLICY" |
        if [[ "$mode" == mismatch && "$index" -eq 0 && "${GH_TOKEN:-}" != fake-samo-token ]]; then jq -c '.name="wrong"'; else cat; fi
    fi
    ;;
  *rulesets\?includes_parents=true*)
    printf '[[{"id":42,"name":"main-samo-only-updates","_links":{"self":{"href":"repos/example/gitzette/rulesets/42"}}},{"id":44,"name":"release-tags-samo-only","_links":{"self":{"href":"repos/example/gitzette/rulesets/44"}}}]]\n'
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

run_failure multiple
[[ ! -e "$test_dir/multiple.mutations" ]]
one_ruleset_policy="$test_dir/one-ruleset.json"
jq 'del(.repository_rulesets[1])' "$root/config/main-branch-protection.json" >"$one_ruleset_policy"
one_ruleset_record="$test_dir/one-ruleset"
if bash "$root/scripts/check-branch-protection-policy-file.sh" "$one_ruleset_policy" \
  >"$one_ruleset_record.out" 2>"$one_ruleset_record.err"; then
  echo "one-ruleset policy unexpectedly applied" >&2
  exit 1
fi
assert_file_contains "$one_ruleset_record.err" 'must define exactly the main and release-tag rulesets'
[[ ! -e "$one_ruleset_record.mutations" && ! -e "$one_ruleset_record.classic" ]]
if grep -q 'possibly partial live policy' "$one_ruleset_record.err"; then
  echo "local policy precondition armed the partial-apply audit" >&2
  exit 1
fi
run_failure admin-bypass
run_failure mismatch
run_failure nonadmin-main-denied
assert_file_contains "$test_dir/nonadmin-main-denied.err" 'lacks the required always-bypass'

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
for mode in nonadmin-admin nonadmin-wrong-id nonadmin-wrong-token nonadmin-zero nonadmin-multiple nonadmin-main-denied nonadmin-tag-denied; do
  run_nonadmin_failure "$mode"
done
assert_file_contains "$test_dir/nonadmin-wrong-token.err" 'GH_TOKEN is not the samo-agent identity'
assert_file_contains "$test_dir/nonadmin-main-denied.err" 'lacks the required always-bypass'
assert_file_contains "$test_dir/nonadmin-tag-denied.err" 'lacks the required always-bypass'

one_record="$test_dir/one"
GITHUB_REPOSITORY=example/gitzette FAKE_MODE=one FAKE_RECORD="$one_record" \
  FAKE_POLICY="$root/config/main-branch-protection.json" PATH="$test_dir:$PATH" \
  bash "$root/scripts/apply-branch-protection.sh" >"$one_record.out" 2>"$one_record.err"
assert_file_contains "$one_record.mutations" '--method PUT repos/example/gitzette/rulesets/42'
assert_file_contains "$one_record.mutations" '--method POST repos/example/gitzette/rulesets'

success_record="$test_dir/success"
GITHUB_REPOSITORY=example/gitzette FAKE_MODE=success FAKE_RECORD="$success_record" \
  FAKE_POLICY="$root/config/main-branch-protection.json" PATH="$test_dir:$PATH" \
  bash "$root/scripts/apply-branch-protection.sh" >"$success_record.out" 2>"$success_record.err"
assert_file_contains "$success_record.mutations" '--method POST repos/example/gitzette/rulesets'
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
