#!/usr/bin/env bash

credential_migration_assert_transfer_state() {
  local bootstrap_expires_at deadline_epoch migration_state now_epoch
  migration_state="${CREDENTIAL_MIGRATION_IN_PROGRESS:-false}"
  if [[ "$migration_state" != true && "$migration_state" != false ]]; then
    echo "CREDENTIAL_MIGRATION_IN_PROGRESS must be exactly true or false" >&2
    return 1
  fi
  [[ "$migration_state" == true ]] || return 0

  bootstrap_expires_at="2026-08-27T00:00:00Z"
  deadline_epoch="$(date -u -d "$bootstrap_expires_at" +%s)"
  now_epoch="$(date -u +%s)"
  if (( now_epoch >= deadline_epoch )); then
    echo "Credential migration schema exclusion expired at $bootstrap_expires_at; enforcing the ordinary strict schema"
    return 0
  fi

  (
    local canonical_sql ddl_json objects_json row_count rows_json table_count table_json temporary_dir
    temporary_dir="$(mktemp -d)"
    trap 'rm -rf "$temporary_dir"' EXIT
    table_json="$temporary_dir/table.json"
    objects_json="$temporary_dir/objects.json"
    rows_json="$temporary_dir/rows.json"
    # The caller sources require-wrangler.sh before this helper.
    # shellcheck disable=SC2154
    "$wrangler_bin" d1 execute gitzette-db --remote --command \
      "SELECT COUNT(*) AS total FROM sqlite_schema WHERE type='table' AND name='credential_migration_transfer'" \
      --json >"$table_json"
    if ! table_count="$(jq -er '.[0].results[0].total | select(. == 0 or . == 1)' "$table_json")"; then
      echo "credential migration transfer table assertion returned invalid evidence" >&2
      return 1
    fi
    if [[ "$table_count" == 1 ]]; then
      ddl_json="$temporary_dir/ddl.json"
      # shellcheck disable=SC2154
      "$wrangler_bin" d1 execute gitzette-db --remote --command \
        "SELECT sql FROM sqlite_schema WHERE type='table' AND name='credential_migration_transfer'" \
        --json >"$ddl_json"
      canonical_sql="$(jq -er '.[0].results | select(length == 1) | .[0].sql | select(type == "string")' "$ddl_json" |
        tr '\n' ' ' |
        sed -E 's/[[:space:]]+/ /g; s/[[:space:]]*([(),])[[:space:]]*/\1/g; s/^ //; s/ $//')"
      if [[ "$canonical_sql" != "create table credential_migration_transfer(run_id text primary key,ciphertext text not null,created_at text not null)" ]]; then
        echo "credential migration transfer table DDL differs from the reviewed schema" >&2
        return 1
      fi
    fi
    # shellcheck disable=SC2154
    "$wrangler_bin" d1 execute gitzette-db --remote --command \
      "SELECT COUNT(*) AS total FROM sqlite_schema WHERE name='credential_migration_transfer' AND type<>'table'" \
      --json >"$objects_json"
    if ! jq -e '.[0].results[0].total | select(. == 0)' "$objects_json" >/dev/null; then
      echo "credential migration transfer name is used by a non-table schema object" >&2
      return 1
    fi
    if [[ "$table_count" == 1 ]]; then
      # shellcheck disable=SC2154
      "$wrangler_bin" d1 execute gitzette-db --remote --command \
        "SELECT COUNT(*) AS total FROM credential_migration_transfer" --json >"$rows_json"
      if ! row_count="$(jq -er '.[0].results[0].total | select(type == "number" and . >= 0 and . <= 1)' "$rows_json")"; then
        echo "credential migration transfer table contains more than one row or invalid evidence" >&2
        return 1
      fi
      echo "Credential migration transfer assertion OK: table has $row_count row(s)"
    else
      echo "Credential migration transfer assertion OK: table is absent"
    fi
  )
}

credential_migration_schema_exclusion() {
  local bootstrap_expires_at deadline_epoch migration_state now_epoch
  migration_state="${CREDENTIAL_MIGRATION_IN_PROGRESS:-false}"
  if [[ "$migration_state" != true && "$migration_state" != false ]]; then
    echo "CREDENTIAL_MIGRATION_IN_PROGRESS must be exactly true or false" >&2
    return 1
  fi
  [[ "$migration_state" == true ]] || return 0
  bootstrap_expires_at="2026-08-27T00:00:00Z"
  deadline_epoch="$(date -u -d "$bootstrap_expires_at" +%s)"
  now_epoch="$(date -u +%s)"
  if (( now_epoch >= deadline_epoch )); then
    echo "Credential migration schema exclusion expired at $bootstrap_expires_at; using the ordinary strict schema comparison" >&2
    return 0
  fi
  printf "%s" " AND NOT (type = 'table' AND name = 'credential_migration_transfer')"
}
