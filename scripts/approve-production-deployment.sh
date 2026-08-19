#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "approve-production-deployment.sh must be executed by path, not sourced or piped to Bash" >&2
  exit 1
fi
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
run_id="${1:-}"
if [[ ! "$run_id" =~ ^[0-9]+$ ]]; then
  echo "usage: GH_TOKEN=<production reviewer token> bash scripts/approve-production-deployment.sh RUN_ID" >&2
  exit 1
fi
if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "GH_TOKEN for a configured production reviewer is required" >&2
  exit 1
fi
if [[ -n "$(git -C "$root" status --porcelain)" ]]; then
  echo "release approval requires a clean checkout" >&2
  exit 1
fi

repository="${GITHUB_REPOSITORY:-$(gh repo view "$(git -C "$root" remote get-url origin)" --json nameWithOwner --jq .nameWithOwner)}"
local_sha="$(git -C "$root" rev-parse HEAD)"
current_user_id="$(gh api user --jq .id)"
current_user_login="$(gh api user --jq .login)"
run="$(gh api "repos/$repository/actions/runs/$run_id")"
main_sha="$(gh api "repos/$repository/git/ref/heads/main" --jq .object.sha)"
pulls="$(gh api --paginate --slurp -H 'Accept: application/vnd.github+json' "repos/$repository/commits/$main_sha/pulls?per_page=100")"
reviewed_sha="$(jq -er --arg sha "$main_sha" 'map(.[]) | map(select(.base.ref == "main" and .merged_at != null and .merge_commit_sha == $sha)) | .[0].head.sha' <<<"$pulls")"
check_run_pages="$(gh api --paginate --slurp "repos/$repository/commits/$reviewed_sha/check-runs?filter=latest&per_page=100")"
status_pages="$(gh api --paginate --slurp "repos/$repository/commits/$reviewed_sha/statuses?per_page=100")"
pending_deployments="$(gh api "repos/$repository/actions/runs/$run_id/pending_deployments")"

approval_document="$(mktemp)"
trap 'rm -f "$approval_document"' EXIT
jq -n \
  --argjson current_user_id "$current_user_id" \
  --arg local_sha "$local_sha" \
  --arg main_sha "$main_sha" \
  --argjson run "$run" \
  --argjson pulls "$pulls" \
  --argjson check_run_pages "$check_run_pages" \
  --argjson status_pages "$status_pages" \
  --argjson pending_deployments "$pending_deployments" \
  '{current_user_id:$current_user_id,local_sha:$local_sha,main_sha:$main_sha,run:$run,pulls:$pulls,check_run_pages:$check_run_pages,status_pages:$status_pages,pending_deployments:$pending_deployments}' \
  >"$approval_document"

approval="$(bun "$root/scripts/approve-production-deployment.ts" "$approval_document")"
environment_id="$(jq -er .environmentId <<<"$approval")"
reviewed_sha="$(jq -er .reviewedSha <<<"$approval")"
jq -n --argjson environment_id "$environment_id" --arg reviewed_sha "$reviewed_sha" \
  '{environment_ids:[$environment_id],state:"approved",comment:("Exact-head samorev and readiness verified for " + $reviewed_sha)}' |
  gh api --method POST "repos/$repository/actions/runs/$run_id/pending_deployments" --input - --silent

echo "Production deployment approved by $current_user_login for reviewed head $reviewed_sha"
