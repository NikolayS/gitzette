# One-shot production credential migration

This bootstrap moves the existing Cloudflare repository secrets into the
protected `production` environment. Plaintext exists only inside the approved
export job and the operator's private session. The job encrypts it with the
reviewed RSA-4096 public key and writes only ciphertext to a transient table in
the private production D1 database. It never publishes an Actions artifact,
log value, output, or environment value.

The operator-held fallback token is restricted to D1, so it can retrieve and
delete the ciphertext but cannot deploy Workers or replace the production
token. Rotate the exported Worker-capable token through a dashboard-authorized
session after service restoration.

0. Set the private key directory containing the already provisioned reviewed
   migration key. Immediately convert that key to passphrase-encrypted PKCS#8
   without changing its public key. Supply the passphrase interactively; do not
   place it in shell history, an environment variable, or a file. Destroy the
   plaintext input only after the encrypted copy's fingerprint is verified.

   ```bash
   export MIGRATION_KEY_DIR="${MIGRATION_KEY_DIR:?set a private directory}"
   install -d -m 0700 "$MIGRATION_KEY_DIR"
   private_key="$MIGRATION_KEY_DIR/production-migration-private.pem"
   encrypted_key="$MIGRATION_KEY_DIR/production-migration-private.encrypted.pem"
   test -s "$private_key"
   openssl pkcs8 -topk8 -v2 aes-256-cbc -in "$private_key" -out "$encrypted_key"
   chmod 600 "$encrypted_key"
   openssl pkey -in "$encrypted_key" \
     -pubout -out "$MIGRATION_KEY_DIR/production-migration-public.pem"
   openssl pkey -in "$encrypted_key" \
     -pubout -outform DER | sha256sum
   shred -u "$private_key"
   mv "$encrypted_key" "$private_key"
   ```

   The fingerprint must be
   `7067899ede540031e13351ac29297fa51c0dc975f9ed2702d1c4dfe937299cdc`.

1. From a clean checkout of protected `main`, apply and verify both reviewed
   environments. `production` temporarily admits the exact non-release tag
   `credential-migration-verify`; no out-of-band policy widening is needed.

   ```bash
   bash scripts/apply-credential-migration-environment.sh
   bash scripts/apply-production-environment.sh
   ```

2. Open the independently removable switch and dispatch exactly one export as
   immutable runner ID `280144521` (`samo-agent`). The workflow concurrency
   group queues any accidental second dispatch.

   ```bash
   gh variable set CREDENTIAL_MIGRATION_OPEN --body true
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
   ```

4. After the export succeeds, retrieve the exact run's ciphertext through the
   D1-only token. Decrypt locally without printing plaintext. Only after valid
   JSON is in memory, drop the entire transient table and delete the workflow
   logs. Keep repository secrets as rollback copies.

   ```bash
   set -euo pipefail
   export CLOUDFLARE_API_TOKEN="$(sed -n 's/^CLOUDFLARE_API_TOKEN=//p' /private/operator/token.env)"
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
     <<<"header = \"Authorization: Bearer $CLOUDFLARE_API_TOKEN\"" |
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
   jq -n '{sql:"drop table credential_migration_transfer"}' >"$migration_dir/drop.json"
   curl --fail --silent --show-error --retry 2 --retry-all-errors \
     --connect-timeout 10 --max-time 30 --config - \
     -H 'Content-Type: application/json' --data-binary "@$migration_dir/drop.json" \
     "https://api.cloudflare.com/client/v4/accounts/$account_id/d1/database/$database_id/query" \
     <<<"header = \"Authorization: Bearer $CLOUDFLARE_API_TOKEN\"" |
     jq -e '.success == true and .result[0].success == true' >/dev/null
   gh api --method DELETE repos/NikolayS/gitzette/actions/runs/RUN_ID/logs
   ```

5. Without printing values or writing plaintext, install both fields in the
   `production` environment and verify the extracted token against the exact
   Worker account. Do not delete repository rollback copies yet.

   ```bash
   account_id="$(jq -j -e -r .CLOUDFLARE_ACCOUNT_ID <<<"$plaintext")"
   api_token="$(jq -j -e -r .CLOUDFLARE_API_TOKEN <<<"$plaintext")"
   printf '%s' "$account_id" | gh secret set CLOUDFLARE_ACCOUNT_ID --env production
   printf '%s' "$api_token" | gh secret set CLOUDFLARE_API_TOKEN --env production
   curl --fail --silent --show-error --connect-timeout 10 --max-time 20 --config - \
     "https://api.cloudflare.com/client/v4/accounts/$account_id/workers/services/gitzette" \
     <<<"header = \"Authorization: Bearer $api_token\"" |
     jq -e '.success == true' >/dev/null
   ```

   Enumerate every `secrets.CLOUDFLARE_*` reference under `.github/workflows`.
   `deploy.yml` and the verifier must use `environment: production`; only the
   one-shot exporter may use repository credentials.

6. Create the exact reviewed non-release tag at current `main`, push it, and
   dispatch stored-value verification as `samo-agent`. The workflow checks the
   tag name and re-resolves protected `main` both before and after Nik's
   production approval. It fails if `main` moved. This tag does not match the
   release workflow's `v*` trigger.

   ```bash
   git fetch origin main
   test "$(git rev-parse origin/main)" = "$(git rev-parse main)"
   git tag credential-migration-verify "$(git rev-parse main)"
   git push origin refs/tags/credential-migration-verify
   GH_TOKEN="$(gh auth token --user samo-agent)" \
     gh workflow run migrate-production-credentials.yml \
       --ref credential-migration-verify -f operation=verify
   gh run watch VERIFY_RUN_ID --exit-status
   git push origin :refs/tags/credential-migration-verify
   git tag -d credential-migration-verify
   bash scripts/check-production-environment.sh
   ```

   Only after verification passes, delete the repository rollback copies:

   ```bash
   gh secret delete CLOUDFLARE_ACCOUNT_ID
   gh secret delete CLOUDFLARE_API_TOKEN
   ```

7. Close the switch and destroy local migration material. GNU `shred -u` is
   used for the encrypted private key and ciphertext; remove the public key.

   ```bash
   gh variable delete CREDENTIAL_MIGRATION_OPEN
   shred -u "$migration_dir/credentials.bin" "$migration_dir/select.json" \
     "$migration_dir/drop.json"
   rmdir "$migration_dir"
   shred -u "$MIGRATION_KEY_DIR/production-migration-private.pem"
   rm -f "$MIGRATION_KEY_DIR/production-migration-public.pem"
   unset plaintext ciphertext account_id api_token CLOUDFLARE_API_TOKEN
   ```

8. Through the exact-head review gate, delete this workflow, its temporary
   environment config/scripts, the extra production tag policy, and the live
   `credential-migration` environment before normal development resumes.
