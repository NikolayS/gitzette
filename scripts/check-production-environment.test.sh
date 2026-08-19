#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT
mkdir -p "$test_root/bin"
cat >"$test_root/bin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
endpoint="${*: -1}"
case "$endpoint" in
  repos/example/gitzette/environments/production)
    if [[ "${FAKE_POLICY_MODE:-ok}" == wrong-reviewer ]]; then reviewer_id=1345402; reviewer_login=NikolayS; else reviewer_id=280144521; reviewer_login=samo-agent; fi
    jq -n --argjson reviewer_id "$reviewer_id" --arg reviewer_login "$reviewer_login" '{
      protection_rules:[{type:"required_reviewers",prevent_self_review:true,reviewers:[{type:"User",reviewer:{id:$reviewer_id,login:$reviewer_login}}]}],
      deployment_branch_policy:{protected_branches:false,custom_branch_policies:true}
    }'
    ;;
  *deployment-branch-policies*)
    printf '%s\n' '[{"branch_policies":[{"name":"v*","type":"tag"}]}]'
    ;;
  *environments/production/secrets*)
    case "${FAKE_SECRET_MODE:-ok}" in
      ok|repository-copy) printf '%s\n' '[{"secrets":[{"name":"CLOUDFLARE_ACCOUNT_ID"},{"name":"CLOUDFLARE_API_TOKEN"}]}]' ;;
      missing) printf '%s\n' '[{"secrets":[{"name":"CLOUDFLARE_ACCOUNT_ID"}]}]' ;;
    esac
    ;;
  *actions/secrets*)
    if [[ "${FAKE_SECRET_MODE:-ok}" == repository-copy ]]; then
      printf '%s\n' '[{"secrets":[{"name":"CLOUDFLARE_API_TOKEN"}]}]'
    else
      printf '%s\n' '[{"secrets":[{"name":"UNRELATED"}]}]'
    fi
    ;;
  *) echo "unexpected fake gh endpoint: $endpoint" >&2; exit 91 ;;
esac
EOF
chmod +x "$test_root/bin/gh"

run_case() {
  expected="$1"
  secret_mode="$2"
  policy_mode="$3"
  actual=0
  PATH="$test_root/bin:$PATH" GITHUB_REPOSITORY=example/gitzette \
    FAKE_SECRET_MODE="$secret_mode" FAKE_POLICY_MODE="$policy_mode" \
    bash "$root/scripts/check-production-environment.sh" >/dev/null 2>&1 || actual=$?
  if [[ "$actual" -ne "$expected" ]]; then
    echo "expected exit $expected for secret=$secret_mode policy=$policy_mode, got $actual" >&2
    exit 1
  fi
}

run_case 0 ok ok
run_case 1 missing ok
run_case 1 repository-copy ok
run_case 1 ok wrong-reviewer

echo "production environment policy tests passed"
