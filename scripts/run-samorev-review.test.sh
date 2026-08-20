#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "run-samorev-review.test.sh must be executed by path, not sourced or piped to Bash" >&2
  if [[ -n "${BASH_SOURCE[0]:-}" ]]; then return 1; fi
  exit 1
fi
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT
mkdir -p "$test_dir/bin" "$test_dir/samorev/src"

cat >"$test_dir/bin/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == -C && "${3:-}" == status ]]; then
  [[ "${FAKE_MODE:-}" != reviewer-dirty ]] || printf '?? untracked-reviewer-edit\n'
elif [[ "${FAKE_MODE:-}" == reviewer-sha ]]; then
  printf 'bad-reviewer-sha\n'
else
  printf '1397e9762c3f7b0f6230260ca4960241dfb38bf2\n'
fi
EOF

cat >"$test_dir/bin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
mode="${FAKE_MODE:-success}"
if [[ "${1:-}" == pr ]]; then
  printf '{"headRefOid":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","url":"https://github.com/example/gitzette/pull/68"}\n'
  exit 0
fi
if [[ "${1:-}" == run ]]; then
  job_name='base-controlled samorev publisher'
  [[ "$mode" != wrong-job ]] || job_name=attacker
  jq -nc --arg name "$job_name" '{jobs:[{databaseId:9,name:$name}]}'
  exit 0
fi
endpoint=''
for argument in "$@"; do
  [[ "$argument" == repos/* ]] && endpoint="$argument"
done
case "$endpoint" in
  repos/example/gitzette/actions/runs/7)
    path=.github/workflows/samorev-gate.yml
    event=pull_request_target
    repository=example/gitzette
    head=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    pr=68
    base=main
    [[ "$mode" != wrong-path ]] || path=.github/workflows/attacker.yml
    [[ "$mode" != wrong-event ]] || event=pull_request
    [[ "$mode" != fork ]] || repository=attacker/gitzette
    [[ "$mode" != wrong-head ]] || head=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
    [[ "$mode" != wrong-pr ]] || pr=67
    jq -nc --arg path "$path" --arg event "$event" --arg repository "$repository" \
      --arg head "$head" --argjson pr "$pr" --arg base "$base" \
      '{head_sha:$head,path:$path,event:$event,head_repository:{full_name:$repository},
        html_url:"https://github.com/example/gitzette/actions/runs/7",
        pull_requests:[{number:$pr,base:{ref:$base},head:{sha:$head}}]}'
    ;;
  repos/example/gitzette/statuses/*)
    state=''
    target=''
    while [[ "$#" -gt 0 ]]; do
      case "$1" in
        state=*) state="${1#state=}" ;;
        target_url=*) target="${1#target_url=}" ;;
      esac
      shift
    done
    printf '%s|%s\n' "$state" "$target" >>"${FAKE_RECORD:?}"
    printf '{}\n'
    ;;
  *) exit 91 ;;
esac
EOF

cat >"$test_dir/bin/bun" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${FAKE_MODE:-success}" in
  success) exit 0 ;;
  report) printf '## samorev Code Review Report\n'; exit 1 ;;
  crash) printf 'provider unavailable\n'; exit 1 ;;
  *) exit 0 ;;
esac
EOF

cat >"$test_dir/bin/mktemp" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
log_file="${FAKE_RECORD:?}.log"
: >"$log_file"
printf '%s\n' "$log_file"
EOF
chmod +x "$test_dir/bin/git" "$test_dir/bin/gh" "$test_dir/bin/bun" "$test_dir/bin/mktemp"

run_case() {
  mode="$1"
  expected_rc="$2"
  expected_terminal="${3:-}"
  record="$test_dir/$mode.statuses"
  : >"$record"
  actual_rc=0
  GH_TOKEN=fake GITHUB_REPOSITORY=example/gitzette SAMOREV_HOME="$test_dir/samorev" \
    FAKE_MODE="$mode" FAKE_RECORD="$record" PATH="$test_dir/bin:$PATH" \
    bash "$root/scripts/run-samorev-review.sh" 68 7 9 >/dev/null 2>&1 || actual_rc=$?
  [[ "$actual_rc" == "$expected_rc" ]] || {
    echo "$mode returned $actual_rc, expected $expected_rc" >&2
    exit 1
  }
  if [[ -n "$expected_terminal" ]]; then
    [[ "$(tail -1 "$record")" == "$expected_terminal|https://github.com/example/gitzette/actions/runs/7" ]] || {
      echo "$mode published the wrong terminal status" >&2
      exit 1
    }
  elif [[ -s "$record" ]]; then
    echo "$mode published before the publisher boundary passed" >&2
    exit 1
  fi
  [[ ! -e "$record.log" ]] || {
    echo "$mode left the reviewer log behind" >&2
    exit 1
  }
}

for mode in wrong-path wrong-event fork wrong-head wrong-pr wrong-job reviewer-sha reviewer-dirty; do
  run_case "$mode" 1
done
run_case success 0 success
run_case report 1 failure
run_case crash 1 error

echo "samorev reviewer wrapper boundary and terminal mapping tests passed"
