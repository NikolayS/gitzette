#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "check-branch-protection-policy-file.sh must be executed by path, not sourced or piped to Bash" >&2
  if [[ -n "${BASH_SOURCE[0]:-}" ]]; then return 1; fi
  exit 1
fi
set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  echo "usage: $0 POLICY_FILE" >&2
  exit 2
fi

policy="$1"
jq -e '
  .required_status_checks.strict == true and
  (.required_status_checks.checks | sort_by(.context)) ==
    [{"context":"policy-api-readability","app_id":15368},{"context":"samorev","app_id":null},{"context":"samorev-gate","app_id":15368},{"context":"typecheck","app_id":15368}] and
  .enforce_admins == true and .required_conversation_resolution == true and
  .required_pull_request_reviews.require_code_owner_reviews == false and
  .required_pull_request_reviews.dismiss_stale_reviews == false and
  .required_pull_request_reviews.required_approving_review_count == 0 and
  .required_pull_request_reviews.require_last_push_approval == false and
  .allow_auto_merge == false and
  .actions_workflow_permissions == {"default_workflow_permissions":"read","can_approve_pull_request_reviews":false} and
  .restrictions == null and .lock_branch == false and
  .block_creations == false and .required_linear_history == false and
  .required_signatures == false and
  (.repository_rulesets | length) == 2 and
  .repository_rulesets[0].name == "main-samo-only-updates" and
  .repository_rulesets[0].target == "branch" and
  .repository_rulesets[0].enforcement == "active" and
  .repository_rulesets[0].bypass_actors == [{"actor_id":280144521,"actor_type":"User","bypass_mode":"always"}] and
  .repository_rulesets[0].conditions.ref_name == {"exclude":[],"include":["refs/heads/main"]} and
  .repository_rulesets[0].rules == [{"type":"creation"},{"type":"update","parameters":{"update_allows_fetch_and_merge":false}},{"type":"deletion"}] and
  .repository_rulesets[1].name == "release-tags-samo-only" and
  .repository_rulesets[1].target == "tag" and
  .repository_rulesets[1].enforcement == "active" and
  .repository_rulesets[1].bypass_actors == [{"actor_id":280144521,"actor_type":"User","bypass_mode":"always"}] and
  .repository_rulesets[1].conditions.ref_name == {"exclude":[],"include":["refs/tags/v*"]} and
  .repository_rulesets[1].rules == [{"type":"creation"},{"type":"update","parameters":{"update_allows_fetch_and_merge":false}},{"type":"deletion"}] and
  .allow_force_pushes == false and .allow_deletions == false
' "$policy" >/dev/null || {
  echo "branch policy is not the complete reviewed main and release-tag policy" >&2
  exit 1
}
