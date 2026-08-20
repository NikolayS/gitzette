#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "merge-reviewed-head.sh must be executed by path, not sourced or piped to Bash" >&2
  if [[ -n "${BASH_SOURCE[0]:-}" ]]; then return 1; fi
  exit 1
fi
set -euo pipefail

if [[ "$#" -ne 1 || ! "$1" =~ ^[0-9]+$ ]]; then
  echo "usage: $0 PR_NUMBER" >&2
  exit 2
fi
if [[ -n "${GH_TOKEN:-}" ]]; then
  echo "GH_TOKEN must be unset so the readiness audit uses the administrator credential" >&2
  exit 1
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repository="${GITHUB_REPOSITORY:-$(gh repo view "$(git -C "$root" remote get-url origin)" --json nameWithOwner --jq .nameWithOwner)}"
pr_number="$1"
if [[ "$(gh api user --jq .id)" != 1345402 ]]; then
  echo "the readiness phase requires the NikolayS administrator credential (immutable ID 1345402)" >&2
  exit 1
fi
if [[ -n "$(git -C "$root" status --porcelain --untracked-files=all)" ]]; then
  echo "merge wrapper requires a clean worktree" >&2
  exit 1
fi

pr="$(gh pr view "$pr_number" --repo "$repository" --json headRefOid,state,baseRefName,headRepository)"
head_sha="$(jq -er .headRefOid <<<"$pr")"
if ! jq -e --arg repository "$repository" '
  .state == "OPEN" and .baseRefName == "main" and .headRepository.nameWithOwner == $repository
' <<<"$pr" >/dev/null; then
  echo "PR must be an open same-repository change targeting main" >&2
  exit 1
fi
if [[ "$(git -C "$root" rev-parse HEAD)" != "$head_sha" ]]; then
  echo "local HEAD does not match the exact PR head" >&2
  exit 1
fi

GITHUB_REPOSITORY="$repository" \
  "$root/scripts/check-release-review-evidence.sh" "$head_sha"
GITHUB_REPOSITORY="$repository" \
  "$root/scripts/check-branch-protection.sh"

# Load the update credential only after the administrator-only audits finish.
# Combining both credentials on one operator host is the explicitly documented
# bootstrap residual risk; this wrapper makes the exact-head evidence step
# inseparable from the sole permitted main update.
samo_token="$(gh auth token --user samo-agent)"
if [[ "$(GH_TOKEN="$samo_token" gh api user --jq .id)" != 280144521 ]]; then
  echo "stored samo-agent credential has the wrong immutable identity" >&2
  exit 1
fi
GH_TOKEN="$samo_token" GITHUB_REPOSITORY="$repository" \
  "$root/scripts/check-branch-protection-nonadmin.sh"

current_head="$(GH_TOKEN="$samo_token" gh pr view "$pr_number" --repo "$repository" --json headRefOid --jq .headRefOid)"
if [[ "$current_head" != "$head_sha" ]]; then
  echo "PR head changed after readiness checks" >&2
  exit 1
fi
GH_TOKEN="$samo_token" gh pr merge "$pr_number" --repo "$repository" \
  --merge --match-head-commit "$head_sha"
