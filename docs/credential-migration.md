# One-shot production credential migration

This bootstrap moves the existing Cloudflare repository secrets into the
protected `production` environment. Plaintext exists only inside the approved
export job and a dedicated child Bash process on the operator host. The job
encrypts it with the reviewed RSA-4096 public key and writes only ciphertext to
a transient table in the private production D1 database. It never publishes an
Actions artifact, log value, output, or environment value.

The operator-held fallback token is restricted to D1, so it can retrieve and
delete the ciphertext but cannot deploy Workers or replace the production
token. Rotate the exported Worker-capable token through a dashboard-authorized
session after service restoration.

Start a disposable child shell with
`HISTFILE=/dev/null bash --noprofile --norc`, then immediately run
`unset HISTFILE; set +o history`; `--noprofile --norc` alone does not disable
history. Run every code block below only inside that child shell. Do not paste a block containing
`set -euo pipefail`, `${VAR:?}`, or `exit` directly into the parent interactive
shell. If a step aborts after decryption, immediately `unset plaintext` and
shred the exact run directory before retrying; if step 0 aborts before the
encrypted-key fingerprint is verified, shred the plaintext private key before
retrying. The parent terminal remains available for that cleanup.

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

1. From a clean checkout of protected `main`, first verify that production
   admits exactly reviewed `main` and `v*` refs. Investigate any diff before changing
   it; do not erase a tamper signal by applying over it. Then apply the
   dedicated migration environment. GitHub's environment API cannot set
   `can_admins_bypass`; if the migration check reports that field as `true`,
   disable **Allow administrators to bypass configured protection rules** in
   Settings -> Environments -> `credential-migration`, then rerun the apply
   command. This UI-only action is expected after first creating the
   environment and is required before export. Production is temporarily widened
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
   bash scripts/check-production-environment.sh
   bash scripts/apply-credential-migration-environment.sh
   bash scripts/check-credential-migration-inventory.sh
   gh workflow run credential-migration-policy-guard.yml --ref main
   gh run watch POLICY_GUARD_RUN_ID --exit-status
   ```

   This preflight dispatch must be green before the scheduled guard is relied
   on; API-read failures exit separately from policy drift. Green proves the
   fixed production policy and that neither migration switch resolves to a
   nonempty value. The scheduled guard deliberately checks only environment
   policy endpoints readable by `GITHUB_TOKEN`; the adjacent inventory command
   uses the operator's administrator token to prove the migration environment
   has no variables or secrets. It
   does not claim that the intentionally installed bootstrap workflow or
   migration environment has already been removed.

   The production policy does not change during export or verification; any
   checker failure is therefore real drift, never an expected migration window.

2. Open the independently removable switch and dispatch exactly one export as
   immutable runner ID `280144521` (`samo-agent`). Workflow concurrency only
   serializes accidental duplicates; it does not reject them. Confirm exactly
   one run exists before approval.

   The only clean closed state is an absent variable. A value of `false`
   prevents the migration job from continuing but is still switch residue, so
   the guard intentionally stays red until the variable is deleted.

   ```bash
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
   that table. Keep repository secrets as rollback copies.

   ```bash
   set -euo pipefail
   gh variable delete CREDENTIAL_EXPORT_OPEN
   operator_token_file="${OPERATOR_TOKEN_FILE:?set the private D1 token file}"
   token_count="$(grep -c '^CLOUDFLARE_API_TOKEN=' "$operator_token_file" || true)"
   [[ "$token_count" == 1 ]]
   d1_token="$(sed -n 's/^CLOUDFLARE_API_TOKEN=//p' "$operator_token_file")"
   [[ -n "$d1_token" && "$d1_token" != *$'\n'* ]]
   account_id="a3265e0d0db71fdece29365819452f00"
   database_id="4a3624d7-7de8-46d5-91f5-7ee79856ccaa"
   migration_dir="$MIGRATION_KEY_DIR/run-RUN_ID-1"
   install -d -m 0700 "$migration_dir"
   jq -n --arg run_id RUN_ID '{
     sql:"select ciphertext from credential_migration_transfer where run_id = ?1",
     params:[$run_id]
   }' >"$migration_dir/select.json"
   ciphertext="$(curl --fail --silent --show-error --retry 2 --retry-all-errors \
     --connect-timeout 10 --max-time 30 --config - \
     -H 'Content-Type: application/json' --data-binary "@$migration_dir/select.json" \
     "https://api.cloudflare.com/client/v4/accounts/$account_id/d1/database/$database_id/query" \
     <<<"header = \"Authorization: Bearer $d1_token\"" |
     jq -er '.result[0].results[0].ciphertext')"
   printf '%s' "$ciphertext" | base64 --decode >"$migration_dir/credentials.bin"
   plaintext="$(openssl pkeyutl -decrypt \
     -inkey "$MIGRATION_KEY_DIR/production-migration-private.pem" \
     -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 \
     -pkeyopt rsa_mgf1_md:sha256 -in "$migration_dir/credentials.bin")"
   jq -e 'type == "object" and
     (.CLOUDFLARE_ACCOUNT_ID | type == "string" and length > 0) and
     (.CLOUDFLARE_API_TOKEN | type == "string" and length > 0)' \
     <<<"$plaintext" >/dev/null
   gh api --method DELETE repos/NikolayS/gitzette/actions/runs/RUN_ID/logs
   ```

5. Without printing values or writing plaintext, install both fields in the
   `production` environment. Independently prove the environment-scoped names
   were updated, then verify the extracted token against the exact Worker
   account. The local ciphertext, encrypted key, and in-memory plaintext remain
   the out-of-band rollback copy.

   ```bash
   secret_write_started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
   account_id="$(jq -j -e -r .CLOUDFLARE_ACCOUNT_ID <<<"$plaintext")"
   api_token="$(jq -j -e -r .CLOUDFLARE_API_TOKEN <<<"$plaintext")"
   printf '%s' "$account_id" | gh secret set CLOUDFLARE_ACCOUNT_ID --env production
   printf '%s' "$api_token" | gh secret set CLOUDFLARE_API_TOKEN --env production
   environment_secrets="$(gh api --paginate --slurp \
     'repos/NikolayS/gitzette/environments/production/secrets?per_page=100' |
     jq -c 'map(.secrets) | add // []')"
   jq -e --arg since "$secret_write_started" '
     ([.[].name] | sort) == ["CLOUDFLARE_ACCOUNT_ID","CLOUDFLARE_API_TOKEN"] and
     all(.[]; .updated_at >= $since)' <<<"$environment_secrets" >/dev/null
   curl --fail --silent --show-error --connect-timeout 10 --max-time 20 --config - \
     "https://api.cloudflare.com/client/v4/accounts/$account_id/workers/services/gitzette" \
     <<<"header = \"Authorization: Bearer $api_token\"" |
     jq -e '.success == true' >/dev/null
   gh secret delete CLOUDFLARE_ACCOUNT_ID
   gh secret delete CLOUDFLARE_API_TOKEN
   remaining_repository_cloudflare_secrets="$(gh secret list --json name --jq \
     '[.[].name | select(startswith("CLOUDFLARE_"))] | length')"
   [[ "$remaining_repository_cloudflare_secrets" == 0 ]]
   jq -n '{sql:"drop table credential_migration_transfer"}' >"$migration_dir/drop.json"
   curl --fail --silent --show-error --retry 2 --retry-all-errors \
     --connect-timeout 10 --max-time 30 --config - \
     -H 'Content-Type: application/json' --data-binary "@$migration_dir/drop.json" \
     "https://api.cloudflare.com/client/v4/accounts/$account_id/d1/database/$database_id/query" \
     <<<"header = \"Authorization: Bearer $d1_token\"" |
     jq -e '.success == true and .result[0].success == true' >/dev/null
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

   ```bash
   git fetch origin main
   test "$(git rev-parse origin/main)" = "$(git rev-parse main)"
   bash scripts/check-credential-migration-environment.sh
   bash scripts/check-credential-migration-inventory.sh
   bash scripts/check-production-environment.sh
   gh variable set CREDENTIAL_VERIFY_OPEN --body true
   GH_TOKEN="$(gh auth token --user samo-agent)" \
     gh workflow run migrate-production-credentials.yml \
       --ref main -f operation=verify
   set +e
   gh run watch VERIFY_RUN_ID --exit-status
   verify_status=$?
   set -e
   gh variable delete CREDENTIAL_VERIFY_OPEN
   bash scripts/check-production-environment.sh
   [[ "$verify_status" == 0 ]]
   ```

   Before Nik approves the production deployment, independently verify outside
   the workflow logs that the run is still pinned to current protected `main`,
   rerun both live environment checks, and record the guard/verification run
   IDs that bound the approval window:

   ```bash
   test "$(gh run view VERIFY_RUN_ID --json headSha --jq .headSha)" = \
     "$(gh api repos/NikolayS/gitzette/commits/main --jq .sha)"
   bash scripts/check-credential-migration-environment.sh
   bash scripts/check-credential-migration-inventory.sh
   bash scripts/check-production-environment.sh
   ```

   The temporary `main` admission remains bounded by Nik's production approval;
   cancellation does not bypass that approval. On any abort or operator shell
   interruption, close the verification switch and re-audit immediately:

   ```bash
   gh variable delete CREDENTIAL_VERIFY_OPEN
   bash scripts/check-production-environment.sh
   ```

   A best-effort scheduled guard also runs approximately every five minutes on
   GitHub's scheduler. Its production-policy job checks both the temporary fixed
   `main` plus `v*` policy and the Nik-only credential-migration approval
   boundary; policy drift is never an expected result.
   Its separate
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

   On verification failure, restore repository rollback scope before debugging:

   ```bash
   printf '%s' "$account_id" | gh secret set CLOUDFLARE_ACCOUNT_ID
   printf '%s' "$api_token" | gh secret set CLOUDFLARE_API_TOKEN
   ```

7. After successful verification, remove local migration material. GNU
   `shred -u` is best-effort cleanup; tmpfs or encrypted storage is the actual
   at-rest control.

   ```bash
   shred -u "$migration_dir/credentials.bin" "$migration_dir/select.json" \
     "$migration_dir/drop.json"
   rmdir "$migration_dir"
   shred -u "$MIGRATION_KEY_DIR/production-migration-private.pem"
   rm -f "$MIGRATION_KEY_DIR/production-migration-public.pem"
   unset plaintext ciphertext account_id api_token d1_token
   ```

8. Through the exact-head review gate, delete
   `.github/workflows/migrate-production-credentials.yml`,
   `.github/workflows/credential-migration-policy-guard.yml`,
   `config/credential-migration-environment.json`,
   all corresponding apply/check scripts, including
   `scripts/check-credential-migration-inventory.sh`,
   `scripts/get-github-environment.sh`, and
   `scripts/credential-migration-gate.test.ts`. Delete the live
   `credential-migration` environment and both repository variables
   `CREDENTIAL_EXPORT_OPEN` and `CREDENTIAL_VERIFY_OPEN`. Remove the temporary
   `main` branch entry from
   `config/production-environment.json`, apply the restored `v*`-only policy,
   remove the `credential_migration_transfer` exclusions from all three
   production schema gates, and audit the ordinary exact-schema policy before
   any later release. Run and record the final green guard
   before deleting its workflow; after merge, prove the two
   workflow files and temporary configs/scripts are absent from `main` and the
   live environment plus both variables return not found.
