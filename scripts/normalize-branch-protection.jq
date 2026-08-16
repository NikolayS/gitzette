{
  actions_workflow_permissions: {
    default_workflow_permissions: $workflow_permissions.default_workflow_permissions,
    can_approve_pull_request_reviews: $workflow_permissions.can_approve_pull_request_reviews
  }
} + ($protection | {
  required_status_checks: {
    strict: (.required_status_checks.strict // false),
    checks: ((.required_status_checks.checks // []) | sort_by(.context))
  },
  enforce_admins: (.enforce_admins.enabled // false),
  required_pull_request_reviews: {
    dismiss_stale_reviews: (.required_pull_request_reviews.dismiss_stale_reviews // false),
    require_code_owner_reviews: (.required_pull_request_reviews.require_code_owner_reviews // false),
    required_approving_review_count: (.required_pull_request_reviews.required_approving_review_count // 0),
    require_last_push_approval: (.required_pull_request_reviews.require_last_push_approval // false),
    dismissal_restrictions: {
      users: ((.required_pull_request_reviews.dismissal_restrictions.users // []) | map(.login) | sort),
      teams: ((.required_pull_request_reviews.dismissal_restrictions.teams // []) | map(.slug) | sort)
    },
    bypass_pull_request_allowances: {
      users: ((.required_pull_request_reviews.bypass_pull_request_allowances.users // []) | map(.login) | sort),
      teams: ((.required_pull_request_reviews.bypass_pull_request_allowances.teams // []) | map(.slug) | sort),
      apps: ((.required_pull_request_reviews.bypass_pull_request_allowances.apps // []) | map(.slug) | sort)
    }
  },
  required_conversation_resolution: (.required_conversation_resolution.enabled // false),
  allow_force_pushes: (.allow_force_pushes.enabled // false),
  allow_deletions: (.allow_deletions.enabled // false),
  required_linear_history: (.required_linear_history.enabled // false),
  required_signatures: (.required_signatures.enabled // false),
  lock_branch: (.lock_branch.enabled // false),
  block_creations: (.block_creations.enabled // false),
  restrictions: (.restrictions // null),
  repository_rulesets: ($rulesets | map({name,target,enforcement,bypass_actors,conditions,rules}) | sort_by(.name))
})
