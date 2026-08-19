#!/usr/bin/env bash
set -euo pipefail

: "${BASE_SHA:?BASE_SHA is required}"
: "${HEAD_SHA:?HEAD_SHA is required}"

if [[ "${WORKFLOW_PERMISSION_SKIP_FETCH:-false}" != true ]]; then
  git fetch --no-tags --depth=1 origin "$BASE_SHA" "$HEAD_SHA"
fi
git cat-file -e "$BASE_SHA^{commit}"
git cat-file -e "$HEAD_SHA^{commit}"

mapfile -d '' changed_workflows < <(
  git diff --name-only -z "$BASE_SHA" "$HEAD_SHA" -- \
    '.github/workflows/*.yml' '.github/workflows/*.yaml'
)
for workflow in "${changed_workflows[@]}"; do
  if ! git cat-file -e "$HEAD_SHA:$workflow" 2>/dev/null; then
    continue
  fi
  if git show "$HEAD_SHA:$workflow" \
    | tr -d "\"'" \
    | grep -Eiq '(^|[[:space:]{,])((statuses|checks)[[:space:]]*:[[:space:]]*write|permissions[[:space:]]*:[[:space:]]*write-all)([[:space:]},#]|$)'; then
    echo "PR changes privileged workflow: $workflow" >&2
    exit 1
  fi
done

echo "PR workflow permissions OK"
