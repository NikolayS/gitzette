# One-shot production credential migration

This bootstrap moves the existing Cloudflare repository secrets into the
protected `production` environment. Plaintext exists only inside the approved
export job and a dedicated child Bash process on the operator host. The job
encrypts it with the reviewed RSA-4096 public key and writes only ciphertext to
a transient table in the live Worker-bound application D1 database. The only
confidentiality control on that stored value is RSA-4096-OAEP: a Worker data
exposure path could leak ciphertext, but not plaintext, during the bootstrap
window. The migration never publishes an Actions artifact, log value, output,
or environment value.

The operator-held fallback token is restricted to D1, so it can retrieve and
delete the ciphertext but cannot deploy Workers or replace the production
token. Rotate the exported Worker-capable token through a dashboard-authorized
session after service restoration.

Start a disposable child shell with
`HISTFILE=/dev/null bash --noprofile --norc`, then immediately run
`unset HISTFILE; set +o history`; `--noprofile --norc` alone does not disable
history. Run every code block below only inside that child shell. Do not paste a block containing
`set -euo pipefail`, `${VAR:?}`, or `exit` directly into the parent interactive
shell. If a step aborts after decryption while the repository rollback copies
still exist, immediately `unset plaintext` and shred the exact run directory
before retrying. Once step 5 deletes those repository copies, do not shred the
run directory: retain `credentials.bin` and the encrypted private key, restore
repository rollback secrets from that retained ciphertext when required, and
destroy the retained material only after the first successful production deploy
and smoke test. If step 0 aborts before the
encrypted-key fingerprint is verified, shred the plaintext private key before
retrying. The parent terminal remains available for that cleanup.

After any child-shell abort, start a new disposable child with the same history
controls, re-export the durable paths and exact run ID, and skip step 0 because
the retained key is already encrypted. For an empty-table recovery, set the new
approved export `RUN_ID` and restart step 4. For a post-decryption abort, restore
the in-memory value only from the retained ciphertext:

```bash
set -euo pipefail
umask 077
export MIGRATION_KEY_DIR="${MIGRATION_KEY_DIR:?set the existing private directory}"
export TMPDIR="$MIGRATION_KEY_DIR"
export OPERATOR_TOKEN_FILE="${OPERATOR_TOKEN_FILE:?set the private D1 token file}"
export RUN_ID="${RUN_ID:?set the exact retained export run ID}"
token_count="$(grep -c '^CLOUDFLARE_API_TOKEN=' "$OPERATOR_TOKEN_FILE" || true)"
[[ "$token_count" == 1 ]]
d1_token="$(sed -n 's/^CLOUDFLARE_API_TOKEN=//p' "$OPERATOR_TOKEN_FILE")"
[[ -n "$d1_token" && "$d1_token" != *$'\n'* ]]
account_id="a3265e0d0db71fdece29365819452f00"
database_id="4a3624d7-7de8-46d5-91f5-7ee79856ccaa"
migration_dir="$MIGRATION_KEY_DIR/run-$RUN_ID-1"
test -s "$migration_dir/credentials.bin"
test -s "$MIGRATION_KEY_DIR/production-migration-private.pem"
plaintext="$(openssl pkeyutl -decrypt \
  -inkey "$MIGRATION_KEY_DIR/production-migration-private.pem" \
  -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 \
  -pkeyopt rsa_mgf1_md:sha256 -in "$migration_dir/credentials.bin")"
printf '%s' "$plaintext" | jq -e 'type == "object" and
  (.CLOUDFLARE_ACCOUNT_ID | type == "string" and length > 0) and
  (.CLOUDFLARE_API_TOKEN | type == "string" and length > 0)' >/dev/null
```

The migration gate tests parse the executable `run` blocks from the workflow
and execute them with wrong dispatcher IDs, refs, attempts, switches, main
SHAs, approvers, and triggering actors. Each violation must exit nonzero; source
text matching is not the authorization proof.

0. Set the private key directory containing the already provisioned reviewed
   migration key. The directory must be on tmpfs or a verified encrypted
   volume; `shred` is only best-effort on journaling, copy-on-write, and SSD
   storage. Immediately convert the key to passphrase-encrypted PKCS#8 without
   changing its public key. Supply the passphrase interactively; do not place it
   in shell history, an environment variable, or a file. Remove the plaintext
   input only after the encrypted copy's fingerprint is verified.

   ```bash
   set -euo pipefail
   umask 077
   export MIGRATION_KEY_DIR="${MIGRATION_KEY_DIR:?set a private directory}"
   install -d -m 0700 "$MIGRATION_KEY_DIR"
   storage_type="$(findmnt -n -o FSTYPE -T "$MIGRATION_KEY_DIR")"
   if [[ "$storage_type" != tmpfs && "${MIGRATION_KEY_STORAGE:-}" != encrypted ]]; then
     echo "MIGRATION_KEY_DIR must be tmpfs or an operator-verified encrypted volume" >&2
     exit 1
   fi
   export TMPDIR="$MIGRATION_KEY_DIR"
   private_key="$MIGRATION_KEY_DIR/production-migration-private.pem"
   encrypted_key="$MIGRATION_KEY_DIR/production-migration-private.encrypted.pem"
   test -s "$private_key"
   openssl pkcs8 -topk8 -v2 aes-256-cbc -v2prf hmacWithSHA256 -iter 600000 \
     -in "$private_key" -out "$encrypted_key"
   chmod 600 "$encrypted_key"
   head -n1 "$encrypted_key" | grep -qx -- '-----BEGIN ENCRYPTED PRIVATE KEY-----'
   if openssl pkey -in "$encrypted_key" -noout -passin pass: 2>/dev/null; then
     echo "encrypted migration key must reject an empty passphrase" >&2
     exit 1
   fi
   expected_fingerprint=7067899ede540031e13351ac29297fa51c0dc975f9ed2702d1c4dfe937299cdc
   actual_fingerprint="$(openssl pkey -in "$encrypted_key" \
     -pubout -outform DER | sha256sum | awk '{print $1}')"
   if [[ "$actual_fingerprint" != "$expected_fingerprint" ]]; then
     echo "encrypted migration key fingerprint mismatch" >&2
     exit 1
   fi
   openssl pkey -in "$encrypted_key" \
     -pubout -out "$MIGRATION_KEY_DIR/production-migration-public.pem"
   shred -u "$private_key"
   mv "$encrypted_key" "$private_key"
   ```

   The fingerprint must be
   `7067899ede540031e13351ac29297fa51c0dc975f9ed2702d1c4dfe937299cdc`.

1. From a clean checkout of protected `main`, apply the newly reviewed
   production policy before its first checker run, then apply the dedicated
   migration environment. This merge intentionally changes production from the
   old `v*`-only policy to `main` plus `v*`; outside this exact merge-to-reapply
   window, investigate any diff before changing it and never erase a tamper
   signal by applying over it. GitHub's environment API cannot set
   `can_admins_bypass`; if the migration check reports that field as `true`,
   disable **Allow administrators to bypass configured protection rules** in
   Settings -> Environments -> `credential-migration`, then rerun the apply
   command. Apply production has the same caveat: if it reports
   `can_admins_bypass: true`, disable the setting for `production` and rerun.
   This UI-only action is expected after first creating an environment and is
   required before export. Production is temporarily widened
   from `v*` tags to reviewed `main` plus `v*` for this bootstrap so the one-shot
   verifier can run. Every production job still requires Nik's environment
   approval, and #67 restores the `v*`-only policy during teardown.
   Both apply scripts refuse to mutate an existing environment while that
   bypass is enabled. After first creation each apply command re-reads the
   environment and hard-fails if the API reports bypass enabled. Nik must disable
   it in the UI, rerun the apply command, and pass the checker before opening a switch.

   The export creates the temporary `credential_migration_transfer` table as a
   durable consumed-once marker. Production schema gates exclude only that exact
   table during this bootstrap; #67 removes the exclusion after dropping the
   table and proves the ordinary exact-schema gate again.

   ```bash
   set -euo pipefail
   bash scripts/apply-production-environment.sh
   bash scripts/check-production-environment.sh
   bash scripts/apply-credential-migration-environment.sh
   bash scripts/check-credential-migration-inventory.sh
   operator_token_file="${OPERATOR_TOKEN_FILE:?set the private D1 token file}"
   token_count="$(grep -c '^CLOUDFLARE_API_TOKEN=' "$operator_token_file" || true)"
   [[ "$token_count" == 1 ]]
   d1_token="$(sed -n 's/^CLOUDFLARE_API_TOKEN=//p' "$operator_token_file")"
   [[ -n "$d1_token" && "$d1_token" != *$'\n'* ]]
   account_id="a3265e0d0db71fdece29365819452f00"
   database_id="4a3624d7-7de8-46d5-91f5-7ee79856ccaa"
   batch_probe_request="$(mktemp)"
   jq -n '{batch:[{sql:"select 1 as batch_probe"}]}' >"$batch_probe_request"
   curl --fail --silent --show-error --connect-timeout 10 --max-time 30 --config - \
     -H 'Content-Type: application/json' --data-binary "@$batch_probe_request" \
     "https://api.cloudflare.com/client/v4/accounts/$account_id/d1/database/$database_id/query" \
     <<<"header = \"Authorization: Bearer $d1_token\"" |
     jq -e '.success == true and (.result | length == 1) and
       .result[0].success == true and .result[0].results == [{batch_probe:1}]' >/dev/null
   rm -f "$batch_probe_request"
   unset d1_token
   echo "Production D1 REST batch preflight OK"
   previous_guard_run_id="$(gh run list \
     --workflow=credential-migration-policy-guard.yml --branch main \
     --event workflow_dispatch --limit 1 \
     --json databaseId --jq '.[0].databaseId // 0')"
   gh workflow run credential-migration-policy-guard.yml --ref main
   POLICY_GUARD_RUN_ID=""
   for _ in {1..20}; do
     candidate="$(gh run list --workflow=credential-migration-policy-guard.yml \
       --branch main --event workflow_dispatch \
       --limit 1 --json databaseId --jq '.[0].databaseId // 0')"
     if [[ "$candidate" -gt "$previous_guard_run_id" ]]; then
       POLICY_GUARD_RUN_ID="$candidate"
       break
     fi
     sleep 2
   done
   : "${POLICY_GUARD_RUN_ID:?new preflight guard run was not observed}"
   gh run watch "$POLICY_GUARD_RUN_ID" --exit-status
   ```

   The read-only `select 1` call is a mandatory live preflight of the exact
   production D1 REST `{batch}` request shape using the D1-only operator token;
   record its timestamp before opening either switch. The following guard
   dispatch must also be green before the scheduled guard is relied on;
   API-read failures exit separately from policy drift. Its independent
   `production-policy`, `migration-policy`, and `migration-switches` jobs prove
   the fixed production policy, the Nik-only migration approval boundary, and
   that neither repository-scoped
   migration switch is nonempty. The adjacent inventory command uses the
   operator's administrator token to prove the credential-migration environment
   has no variables or secrets, the production environment has no variables
   that can shadow the verification switch, and its secrets stay within the
   reviewed Cloudflare allowlist. Together these checks prove neither migration
   switch resolves to a nonempty value. The scheduled guard deliberately checks
   only environment policy endpoints readable by `GITHUB_TOKEN`; it
   does not claim that the intentionally installed bootstrap workflow or
   migration environment has already been removed.

   From merge until `scripts/apply-production-environment.sh` succeeds, the
   scheduled guard's `production-policy` job is expected red because production
   policy is stale. Separately, `migration-policy` is expected red with exit 4
   only until `scripts/apply-credential-migration-environment.sh` creates and
   configures the temporary environment. These are the only bounded expected-red
   windows for those jobs; afterward, red in either job is drift.

   After both applies, production policy does not change during export or
   verification; any checker failure is therefore real drift.

   Throughout this temporary window, prefix every manual `bun run db:migrate`
   invocation with `CREDENTIAL_MIGRATION_IN_PROGRESS=true`. Without that exact
   value, the ordinary schema gates correctly reject the temporary transfer
   table as drift. Do not run `bun run db:bootstrap` or
   `scripts/bootstrap-production-db.sh`: bootstrap requires a completely empty
   database and correctly rejects the transfer table.

2. Open the independently removable switch and dispatch exactly one export as
   immutable runner ID `280144521` (`samo-agent`). Workflow concurrency only
   serializes accidental duplicates; it does not reject them. Confirm exactly
   one run exists before approval.

   The only clean closed state is an absent variable. A value of `false`
   prevents the migration job from continuing but is still switch residue, so
   the guard intentionally stays red until the variable is deleted.

   ```bash
   set -euo pipefail
   bash scripts/check-credential-migration-environment.sh
   bash scripts/check-credential-migration-inventory.sh
   gh variable set CREDENTIAL_EXPORT_OPEN --body true
   GH_TOKEN="$(gh auth token --user samo-agent)" \
     gh workflow run migrate-production-credentials.yml --ref main -f operation=export
   ```

3. Before Nik approves the pending `credential-migration` deployment, verify
   the run is the only migration run, its ref is `refs/heads/main`, its head is
   the reviewed current `main` tip, original dispatcher ID is `280144521`, and
   `run_attempt` is `1`. Independently derive the fingerprint and recheck the
   live environment policy.

   ```bash
   set -euo pipefail
   openssl pkey -in "$MIGRATION_KEY_DIR/production-migration-private.pem" \
     -pubout -outform DER | sha256sum
   bash scripts/check-credential-migration-environment.sh
   bash scripts/check-credential-migration-inventory.sh
   ```

   Record the exact pre-approval guard and export run IDs in the incident log.
   Run both credential-migration checks again
   immediately before approval; do not approve if either the run identity or
   the environment check differs from the recorded evidence.

4. Immediately after the single export succeeds, close the switch before a
   queued duplicate can start, then retrieve the exact run's ciphertext through the
   D1-only token. Decrypt locally without printing plaintext. Only after valid
   JSON is in memory, delete the workflow logs but retain the entire transfer
   table as a durable consumed-once marker. A second export cannot recreate
   that table. The retrieval must prove the table contains exactly one row,
   that row belongs to the expected `RUN_ID`, and no other `run_id` exists.
   Keep repository secrets as rollback copies.

   The export POST is deliberately never retried. If its job is red because the
   response was lost, do not rerun that workflow run. Close the switch and query
   the exact `RUN_ID`. When a row exists, decrypt it and never replay the export.
   A table containing zero rows means the multi-query request stopped between
   table creation and insert. The block below records that incident, drops only
   the verified empty transfer table with the D1-only token, proves it absent,
   reopens the switch, and dispatches exactly one new run for a fresh Nik
   approval. A proven-absent table means the job failed before the D1 write; it
   is recoverable by the same one-time re-dispatch without a drop because no row
   or consumed-once marker exists. This does not consume the one-shot authority,
   and the rerun button remains forbidden by `run_attempt != 1`; recovery always
   creates one fresh dispatch and one fresh Nik approval. Any unexpected row or
   nonzero count other than one remains a hard stop with repository rollback
   copies intact.

   The reviewed Cloudflare D1 `/query` contract accepts either a single
   `{sql, params}` object or a `{batch}` array of query objects. The exporter uses
   the documented `{batch}` form and requires one successful result per entry,
   including `result[1].meta.changes == 1` for the guarded insert. Contract
   reviewed 2026-08-19 against
   <https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/>.

   ```bash
   set -euo pipefail
   : "${RUN_ID:?set the exact export run ID}"
   if ! gh variable delete CREDENTIAL_EXPORT_OPEN 2>/dev/null; then
     remaining_export_switches="$(gh variable list --json name --jq \
       '[.[].name | select(. == "CREDENTIAL_EXPORT_OPEN")] | length')"
     [[ "$remaining_export_switches" == 0 ]]
   fi
   operator_token_file="${OPERATOR_TOKEN_FILE:?set the private D1 token file}"
   token_count="$(grep -c '^CLOUDFLARE_API_TOKEN=' "$operator_token_file" || true)"
   [[ "$token_count" == 1 ]]
   d1_token="$(sed -n 's/^CLOUDFLARE_API_TOKEN=//p' "$operator_token_file")"
   [[ -n "$d1_token" && "$d1_token" != *$'\n'* ]]
   account_id="a3265e0d0db71fdece29365819452f00"
   database_id="4a3624d7-7de8-46d5-91f5-7ee79856ccaa"
   migration_dir="$MIGRATION_KEY_DIR/run-$RUN_ID-1"
   install -d -m 0700 "$migration_dir"
   dispatch_export_recovery() {
     local recovery_state="$1"
     bash scripts/check-credential-migration-environment.sh
     bash scripts/check-credential-migration-inventory.sh
     gh variable set CREDENTIAL_EXPORT_OPEN --body true
     GH_TOKEN="$(gh auth token --user samo-agent)" \
       gh workflow run migrate-production-credentials.yml --ref main -f operation=export
     echo "$recovery_state recovery dispatched once; stop and obtain the new exact run ID" >&2
     exit 1
   }
   jq -n '{sql:"select count(*) as total from sqlite_schema where type = \u0027table\u0027 and name = \u0027credential_migration_transfer\u0027"}' \
     >"$migration_dir/table-count.json"
   transfer_table_count="$(curl --fail --silent --show-error --retry 2 --retry-all-errors \
     --connect-timeout 10 --max-time 30 --config - \
     -H 'Content-Type: application/json' --data-binary "@$migration_dir/table-count.json" \
     "https://api.cloudflare.com/client/v4/accounts/$account_id/d1/database/$database_id/query" \
     <<<"header = \"Authorization: Bearer $d1_token\"" |
     jq -er 'select(.success == true) | .result[0] | select(.success == true) |
       .results[0].total | select(. == 0 or . == 1)')"
   if [[ "$transfer_table_count" == 0 ]]; then
     printf '%s export run %s failed before creating the transfer table\n' \
       "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$RUN_ID" >>"$migration_dir/incident.log"
     dispatch_export_recovery absent-table
   fi
   jq -n '{sql:"select count(*) as total_rows from credential_migration_transfer"}' \
     >"$migration_dir/count.json"
   transfer_rows="$(curl --fail --silent --show-error --retry 2 --retry-all-errors \
     --connect-timeout 10 --max-time 30 --config - \
     -H 'Content-Type: application/json' --data-binary "@$migration_dir/count.json" \
     "https://api.cloudflare.com/client/v4/accounts/$account_id/d1/database/$database_id/query" \
     <<<"header = \"Authorization: Bearer $d1_token\"" |
     jq -er '.result[0].results[0].total_rows')"
   if [[ "$transfer_rows" == 0 ]]; then
     printf '%s export run %s created an empty transfer table\n' \
       "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$RUN_ID" >>"$migration_dir/incident.log"
     jq -n '{sql:"drop table credential_migration_transfer"}' >"$migration_dir/drop.json"
     curl --fail --silent --show-error --connect-timeout 10 --max-time 30 --config - \
       -H 'Content-Type: application/json' --data-binary "@$migration_dir/drop.json" \
       "https://api.cloudflare.com/client/v4/accounts/$account_id/d1/database/$database_id/query" \
       <<<"header = \"Authorization: Bearer $d1_token\"" |
       jq -e '.success == true and (.result | length == 1) and .result[0].success == true' >/dev/null
     jq -n '{sql:"select count(*) as remaining from sqlite_schema where type = \u0027table\u0027 and name = \u0027credential_migration_transfer\u0027"}' \
       >"$migration_dir/prove-drop.json"
     curl --fail --silent --show-error --connect-timeout 10 --max-time 30 --config - \
       -H 'Content-Type: application/json' --data-binary "@$migration_dir/prove-drop.json" \
       "https://api.cloudflare.com/client/v4/accounts/$account_id/d1/database/$database_id/query" \
       <<<"header = \"Authorization: Bearer $d1_token\"" |
       jq -e '.success == true and .result[0].results[0].remaining == 0' >/dev/null
     dispatch_export_recovery empty-table
   fi
   [[ "$transfer_rows" == 1 ]]
   jq -n --arg run_id "$RUN_ID" '{
     sql:"select ciphertext, (select count(*) from credential_migration_transfer) as total_rows, (select count(*) from credential_migration_transfer where run_id = ?1) as expected_rows, (select count(*) from credential_migration_transfer where run_id <> ?1) as other_rows from credential_migration_transfer where run_id = ?1",
     params:[$run_id]
   }' >"$migration_dir/select.json"
   ciphertext="$(curl --fail --silent --show-error --retry 2 --retry-all-errors \
     --connect-timeout 10 --max-time 30 --config - \
     -H 'Content-Type: application/json' --data-binary "@$migration_dir/select.json" \
     "https://api.cloudflare.com/client/v4/accounts/$account_id/d1/database/$database_id/query" \
     <<<"header = \"Authorization: Bearer $d1_token\"" |
     jq -er '.result[0].results[0] |
       select(.total_rows == 1 and .expected_rows == 1 and .other_rows == 0) |
       .ciphertext')"
   printf '%s' "$ciphertext" | base64 --decode >"$migration_dir/credentials.bin"
   plaintext="$(openssl pkeyutl -decrypt \
     -inkey "$MIGRATION_KEY_DIR/production-migration-private.pem" \
     -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 \
     -pkeyopt rsa_mgf1_md:sha256 -in "$migration_dir/credentials.bin")"
   printf '%s' "$plaintext" | jq -e 'type == "object" and
     (.CLOUDFLARE_ACCOUNT_ID | type == "string" and length > 0) and
     (.CLOUDFLARE_API_TOKEN | type == "string" and length > 0)' >/dev/null
   gh api --method DELETE "repos/NikolayS/gitzette/actions/runs/$RUN_ID/logs"
   ```

5. Without printing values or writing plaintext, install both fields in the
   `production` environment. Independently prove the environment-scoped names
   were updated, then verify the extracted token against the exact Worker
   account. The local ciphertext, encrypted key, and in-memory plaintext remain
   the out-of-band rollback copy.

   ```bash
   set -euo pipefail
   environment_secrets_before="$(gh api --paginate --slurp \
     'repos/NikolayS/gitzette/environments/production/secrets?per_page=100' |
     jq -c 'map(.secrets) | add // []')"
   exported_account_id="$(printf '%s' "$plaintext" | jq -j -e -r .CLOUDFLARE_ACCOUNT_ID)"
   api_token="$(printf '%s' "$plaintext" | jq -j -e -r .CLOUDFLARE_API_TOKEN)"
   [[ "$exported_account_id" == "$account_id" ]] || {
     echo "exported account ID is not the reviewed Worker account" >&2
     exit 1
   }
   printf '%s' "$exported_account_id" | gh secret set CLOUDFLARE_ACCOUNT_ID --env production
   printf '%s' "$api_token" | gh secret set CLOUDFLARE_API_TOKEN --env production
   environment_secrets="$(gh api --paginate --slurp \
     'repos/NikolayS/gitzette/environments/production/secrets?per_page=100' |
     jq -c 'map(.secrets) | add // []')"
   jq -e --argjson before "$environment_secrets_before" '
     ([.[].name] | sort) == ["CLOUDFLARE_ACCOUNT_ID","CLOUDFLARE_API_TOKEN"] and
     all(.[]; . as $current |
       ($before | map(select(.name == $current.name)) | .[0].updated_at // "") <=
       $current.updated_at)' <<<"$environment_secrets" >/dev/null
   curl --fail --silent --show-error --connect-timeout 10 --max-time 20 --config - \
     "https://api.cloudflare.com/client/v4/accounts/$exported_account_id/workers/services/gitzette" \
     <<<"header = \"Authorization: Bearer $api_token\"" |
     jq -e '.success == true' >/dev/null
   gh secret delete CLOUDFLARE_ACCOUNT_ID
   gh secret delete CLOUDFLARE_API_TOKEN
   remaining_repository_cloudflare_secrets="$(gh secret list --json name --jq \
     '[.[].name | select(startswith("CLOUDFLARE_"))] | length')"
   [[ "$remaining_repository_cloudflare_secrets" == 0 ]]
   ```

   Enumerate every `secrets.CLOUDFLARE_*` reference under `.github/workflows`.
   `deploy.yml` and the verifier must use `environment: production`; only the
   one-shot exporter may use repository credentials.

   Repository copies must be absent before stored-value verification; otherwise
   GitHub can silently fall back from a missing environment secret to the same
   repository secret. If verification later fails, restore repository copies
   from `$plaintext` immediately. Delete the
   repository copies again before any verification retry.

6. From a clean checkout exactly synchronized to protected `main`, run
   stored-value verification as `samo-agent`. GitHub pins the workflow
   run to the immutable `main` SHA at dispatch; the workflow re-resolves
   protected `main` both before and after Nik's production approval and fails
   if it moved. The dispatcher and triggering actor must both be immutable
   `samo-agent` ID `280144521`, and the non-bypassable production environment
   requires Nik ID `1345402` to approve that exact run. Same-repository Actions
   workflows possess neither identity.

   A green verifier is valid evidence only when paired with the recorded
   `REQUIRE_NO_REPOSITORY_CREDENTIALS=true` inventory output from the same
   dispatch/approval window. The workflow token cannot enumerate repository
   secret names, so the run alone cannot distinguish an environment value from
   GitHub's same-named repository-secret fallback.

   ```bash
   set -euo pipefail
   : "${plaintext:?re-run the post-decryption restore block from retained ciphertext first}"
   git fetch origin main
   test "$(git rev-parse origin/main)" = "$(git rev-parse main)"
   bash scripts/check-credential-migration-environment.sh
   REQUIRE_PRODUCTION_CREDENTIALS=true \
   REQUIRE_NO_REPOSITORY_CREDENTIALS=true \
     bash scripts/check-credential-migration-inventory.sh
   bash scripts/check-production-environment.sh
   gh variable set CREDENTIAL_VERIFY_OPEN --body true
   previous_verify_run_id="$(gh run list --workflow=migrate-production-credentials.yml \
     --branch main --event workflow_dispatch --limit 1 \
     --json databaseId --jq '.[0].databaseId // 0')"
   GH_TOKEN="$(gh auth token --user samo-agent)" \
     gh workflow run migrate-production-credentials.yml \
       --ref main -f operation=verify
   VERIFY_RUN_ID=""
   for _ in {1..20}; do
     candidate="$(gh run list --workflow=migrate-production-credentials.yml \
       --branch main --event workflow_dispatch \
       --limit 1 --json databaseId --jq '.[0].databaseId // 0')"
     if [[ "$candidate" -gt "$previous_verify_run_id" ]]; then
       VERIFY_RUN_ID="$candidate"
       break
     fi
     sleep 2
   done
   : "${VERIFY_RUN_ID:?new verification run was not observed}"
   set +e
   gh run watch "$VERIFY_RUN_ID" --exit-status
   verify_status=$?
   set -e
   rollback_restored=false
   if [[ "$verify_status" != 0 ]]; then
     rollback_account_id="$(printf '%s' "$plaintext" | jq -j -e -r .CLOUDFLARE_ACCOUNT_ID)"
     rollback_api_token="$(printf '%s' "$plaintext" | jq -j -e -r .CLOUDFLARE_API_TOKEN)"
     printf '%s' "$rollback_account_id" | gh secret set CLOUDFLARE_ACCOUNT_ID
     printf '%s' "$rollback_api_token" | gh secret set CLOUDFLARE_API_TOKEN
     unset rollback_account_id rollback_api_token
     rollback_restored=true
   fi
   if ! gh variable delete CREDENTIAL_VERIFY_OPEN 2>/dev/null; then
     remaining_verify_switches="$(gh variable list --json name --jq \
       '[.[].name | select(. == "CREDENTIAL_VERIFY_OPEN")] | length')"
     [[ "$remaining_verify_switches" == 0 ]]
   fi
   bash scripts/check-production-environment.sh
   if [[ "$rollback_restored" == true ]]; then
     echo "verification failed; repository rollback credentials restored" >&2
     exit 1
   fi
   ```

   After repairing and revalidating the environment values, delete those
   rollback copies and re-prove their absence before any verification retry:

   ```bash
   set -euo pipefail
   gh secret delete CLOUDFLARE_ACCOUNT_ID 2>/dev/null || true
   gh secret delete CLOUDFLARE_API_TOKEN 2>/dev/null || true
   REQUIRE_PRODUCTION_CREDENTIALS=true \
   REQUIRE_NO_REPOSITORY_CREDENTIALS=true \
     bash scripts/check-credential-migration-inventory.sh
   ```

   Before Nik approves the production deployment, independently verify outside
   the workflow logs that the run is still pinned to current protected `main`,
   rerun both live environment checks, and record the guard/verification run
   IDs that bound the approval window:

   ```bash
   set -euo pipefail
   : "${VERIFY_RUN_ID:?set the exact verification run ID}"
   test "$(gh run view "$VERIFY_RUN_ID" --json headSha --jq .headSha)" = \
     "$(gh api repos/NikolayS/gitzette/commits/main --jq .sha)"
   bash scripts/check-credential-migration-environment.sh
   REQUIRE_PRODUCTION_CREDENTIALS=true \
   REQUIRE_NO_REPOSITORY_CREDENTIALS=true \
     bash scripts/check-credential-migration-inventory.sh
   bash scripts/check-production-environment.sh
   ```

   The temporary `main` admission remains bounded by Nik's production approval;
   cancellation does not bypass that approval. On any abort or operator shell
   interruption, close the verification switch and re-audit immediately:

   ```bash
   set -euo pipefail
   if ! gh variable delete CREDENTIAL_VERIFY_OPEN 2>/dev/null; then
     remaining_verify_switches="$(gh variable list --json name --jq \
       '[.[].name | select(. == "CREDENTIAL_VERIFY_OPEN")] | length')"
     [[ "$remaining_verify_switches" == 0 ]]
   fi
   bash scripts/check-production-environment.sh
   ```

   A best-effort scheduled guard also runs approximately every five minutes on
   GitHub's scheduler. Its independent `production-policy` and
   `migration-policy` jobs check the temporary fixed `main` plus `v*` policy and
   the Nik-only credential-migration approval boundary, so one failure never
   masks the other. Policy drift is never an expected result. Its separate
   switch-residue job is expected red during an open export switch or the
   legitimate production approval wait.
   After cleanup, explicitly dispatch that guard and require it to turn green;
   a red result after the verify run is no longer waiting is lingering
   switch residue. The explicit post-cleanup dispatch, not schedule timing, is
   authoritative for closing this operational window. GitHub schedules are
   best-effort and may be delayed or disabled after repository inactivity. The
   green manual run does not prove final
   deletion of the bootstrap workflow or environment; the #67 teardown diff
   and live deletion checks prove that separately.
   Record its run ID next to the pre-verification run ID and reconcile every red
   scheduled run between them to this single verification window.

   The migration workflow fails closed at `2026-08-27T00:00:00Z` before initial
   authorization and again after either environment approval. The temporary
   policy guard reports the same deadline. Any remaining bootstrap workflow or
   policy then is an incident, not an extension; teardown must remove the guard
   only together with the migration surface.

7. After successful read-capability verification, drop the transfer table and
   remove nonessential local material, but retain the encrypted private key and
   `credentials.bin` rollback ciphertext until the first production deploy and
   mandatory smoke test succeed. The API probe above does not prove the token's
   Workers edit scope; destroying rollback material here would be premature.

   ```bash
   set -euo pipefail
   jq -n '{sql:"drop table credential_migration_transfer"}' >"$migration_dir/drop.json"
   curl --fail --silent --show-error \
     --connect-timeout 10 --max-time 30 --config - \
     -H 'Content-Type: application/json' --data-binary "@$migration_dir/drop.json" \
     "https://api.cloudflare.com/client/v4/accounts/$account_id/d1/database/$database_id/query" \
     <<<"header = \"Authorization: Bearer $d1_token\"" |
     jq -e '.success == true and (.result | length == 1) and .result[0].success == true' >/dev/null
   jq -n '{sql:"select count(*) as remaining from sqlite_schema where type = \u0027table\u0027 and name = \u0027credential_migration_transfer\u0027"}' \
     >"$migration_dir/prove-drop.json"
   curl --fail --silent --show-error --connect-timeout 10 --max-time 30 --config - \
     -H 'Content-Type: application/json' --data-binary "@$migration_dir/prove-drop.json" \
     "https://api.cloudflare.com/client/v4/accounts/$account_id/d1/database/$database_id/query" \
     <<<"header = \"Authorization: Bearer $d1_token\"" |
     jq -e '.success == true and (.result | length == 1) and
       .result[0].success == true and (.result[0].results | length == 1) and
       .result[0].results[0].remaining == 0' >/dev/null
   unset plaintext ciphertext account_id api_token d1_token
   for material in table-count.json select.json count.json drop.json prove-drop.json incident.log; do
     [[ ! -f "$migration_dir/$material" ]] || shred -u "$migration_dir/$material"
   done
   test -s "$migration_dir/credentials.bin"
   test -s "$MIGRATION_KEY_DIR/production-migration-private.pem"
   ```

8. Through the exact-head review gate, delete
   `.github/workflows/migrate-production-credentials.yml`,
   `.github/workflows/credential-migration-policy-guard.yml`,
   `config/credential-migration-environment.json`,
   all corresponding apply/check scripts, including
   `scripts/check-credential-migration-inventory.sh`,
   `scripts/credential-migration-schema-exclusion.sh`, and
   `scripts/credential-migration-gate.test.ts`. Delete the live
   `credential-migration` environment and both repository variables
   `CREDENTIAL_EXPORT_OPEN` and `CREDENTIAL_VERIFY_OPEN`. Remove the temporary
   `main` branch entry from
   `config/production-environment.json`, apply the restored `v*`-only policy,
   remove `CREDENTIAL_MIGRATION_IN_PROGRESS` from `deploy.yml` so all three
   production schema gates again require the transfer table to be absent,
   remove the temporary manual-migration notice from
   `docs/production-migrations.md`,
   remove the transient credential-migration
   readability block from `.github/workflows/ci.yml`, and audit the ordinary exact-schema policy before
   any later release. Run and record the final green guard
   before deleting its workflow; after merge, prove the two
   workflow files and temporary configs/scripts are absent from `main` and the
   live environment plus both variables return not found.
   Retain `scripts/get-github-environment.sh`: it is a shared helper used by
   the permanent production-environment audit and apply scripts.
   Do not remove the temporary `main` production branch policy before the #67
   teardown merges. The fixed widened policy is the reviewed verification path,
   so its guard intentionally reports any early tightening as drift; #67 must
   restore the safer `v*`-only policy atomically with removal of the bootstrap
   workflows, switches, environment, and schema exclusion.
   Tighten `scripts/check-reviewer-credential-isolation.sh` at the same time:
   repository Actions variables must be empty and repository Actions secrets
   may contain only the reviewed `CLAUDE_CODE_OAUTH_TOKEN` after migration,
   while only the `production` environment retains the two reviewed Cloudflare
   secret names. Run `REQUIRE_PRODUCTION_CREDENTIALS=true bash
   scripts/check-reviewer-credential-isolation.sh` in the post-teardown proof so re-created
   repository rollback copies or switches fail closed.

9. Create the reviewed release tag only after the teardown change passes its
   own exact-head review gate. After that tag's production deployment and the
   mandatory smoke test both succeed, destroy the retained encrypted rollback
   material. GNU `shred -u` remains best-effort; tmpfs or encrypted storage is
   the actual at-rest control.

   ```bash
   set -euo pipefail
   : "${DEPLOY_RUN_ID:?set the first successful post-migration deploy run ID}"
   : "${RELEASE_TAG:?set the reviewed post-migration release tag}"
   git fetch origin "refs/tags/$RELEASE_TAG:refs/tags/$RELEASE_TAG"
   release_sha="$(git rev-list -n1 "$RELEASE_TAG")"
   deploy_evidence="$(gh run view "$DEPLOY_RUN_ID" \
     --json conclusion,event,headSha,workflowName)"
   jq -e --arg release_sha "$release_sha" '
     .conclusion == "success" and .event == "push" and
     .workflowName == "Deploy" and .headSha == $release_sha' \
     <<<"$deploy_evidence" >/dev/null
   smoke_root=/tmp/gl-dispatch
   smoke_dir="$smoke_root/dispatch"
   smoke_test="$smoke_dir/smoke-test.sh"
   for smoke_path in "$smoke_root" "$smoke_dir" "$smoke_test"; do
     [[ -e "$smoke_path" && ! -L "$smoke_path" ]]
     [[ "$(stat -Lc %u "$smoke_path")" == "$(id -u)" ]]
     chmod go-w "$smoke_path"
     smoke_mode="$(stat -Lc %a "$smoke_path")"
     (( (8#$smoke_mode & 0022) == 0 ))
   done
   bash /tmp/gl-dispatch/dispatch/smoke-test.sh
   shred -u "$migration_dir/credentials.bin"
   shred -u "$MIGRATION_KEY_DIR/production-migration-private.pem"
   rm -f "$MIGRATION_KEY_DIR/production-migration-public.pem"
   rmdir "$migration_dir"
   unset deploy_evidence release_sha DEPLOY_RUN_ID RELEASE_TAG
   ```
