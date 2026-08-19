# One-shot production credential migration

This bootstrap moves the existing Cloudflare repository secrets into the
protected `production` environment without exposing plaintext outside GitHub's
secret store and the operator's private local session. The encrypted artifact
is still sensitive: download it immediately, delete it and the run logs after
decryption, and destroy the migration private key after the environment secrets
have been verified.

This repository is public, so the encrypted artifact is publicly downloadable
until deletion. Retention is only a one-day backstop: the operator deletes the
artifact within minutes of download. Anyone may harvest the ciphertext, and
its confidentiality permanently depends on the RSA-4096 private key never
leaking. A purely local export was rejected because GitHub never reveals an
existing repository secret to a local or environment approver; only an Actions
job can consume it.

Rotating instead of exporting would be preferable, but it is not available to
this automated recovery: GitHub does not reveal existing secret values, and the
only operator-held Cloudflare token available to the recovery runtime is
D1-only (Workers, schedules, and token-management endpoints return 403), so it
cannot create or replace a Worker-capable production token. A dashboard-authorized token rotation
remains required after service restoration; this exporter exists only to avoid
destroying the sole currently deploy-capable credential before that handoff.

0. Generate the migration-only RSA-4096 key inside the operator session, keep
   the private key mode `0600`, record the public DER fingerprint out of band,
   and never copy the unencrypted private key outside this host:

   ```bash
   umask 077
   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 \
     -out /home/tars/.secrets/gitzette-production-migration-private.pem
   chmod 600 /home/tars/.secrets/gitzette-production-migration-private.pem
   openssl pkey -in /home/tars/.secrets/gitzette-production-migration-private.pem \
     -pubout -out /home/tars/.secrets/gitzette-production-migration-public.pem
   openssl pkey -in /home/tars/.secrets/gitzette-production-migration-private.pem \
     -pubout -outform DER | sha256sum
   ```

1. From a clean checkout of protected `main`, apply and verify the temporary
   Nik-only environment:

   ```bash
   bash scripts/apply-credential-migration-environment.sh
   ```

   The apply script sends `can_admins_bypass: false` and the checker reads it
   back from GitHub. This exact API path was verified live on 2026-08-19; the
   resulting environment reported `false`, sole reviewer ID `1345402`, and
   `prevent_self_review: true`.

2. Set the independently removable switch, then dispatch as immutable runner
   ID `280144521` (`samo-agent`):

   ```bash
   gh variable set CREDENTIAL_MIGRATION_OPEN --body true
   GH_TOKEN="$(gh auth token --user samo-agent)" \
     gh workflow run migrate-production-credentials.yml --ref main
   ```

3. Before Nik approves the pending `credential-migration` deployment, verify
   all of the following: the ref is exactly `refs/heads/main`; the run head SHA
   equals the reviewed current `main` tip; original dispatcher ID is
   `280144521`; `run_attempt` is exactly `1`; and the reviewed public-key fingerprint is
   `7067899ede540031e13351ac29297fa51c0dc975f9ed2702d1c4dfe937299cdc`.
   Independently derive that fingerprint from the operator key:

   ```bash
   openssl pkey -in /home/tars/.secrets/gitzette-production-migration-private.pem \
     -pubout -outform DER | sha256sum
   ```

4. Download the exact run's one-day artifact and decrypt locally:

   ```bash
   migration_dir=/home/tars/.secrets/gitzette-migration-RUN_ID-1
   install -d -m 0700 "$migration_dir"
   gh run download RUN_ID --name encrypted-credentials-RUN_ID-1 --dir "$migration_dir"
   plaintext="$(openssl pkeyutl -decrypt \
     -inkey /home/tars/.secrets/gitzette-production-migration-private.pem \
     -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 \
     -pkeyopt rsa_mgf1_md:sha256 \
     -in "$migration_dir/credentials.bin")"
   ```

5. Without printing the values or writing another plaintext file, pipe each
   field from `$plaintext` into `gh secret set --env production`. Unset the
   variable, verify both environment-secret names exist, then delete the two
   repository-scoped copies.

   ```bash
   jq -j -e -r .CLOUDFLARE_ACCOUNT_ID <<<"$plaintext" |
     gh secret set CLOUDFLARE_ACCOUNT_ID --env production
   jq -j -e -r .CLOUDFLARE_API_TOKEN <<<"$plaintext" |
     gh secret set CLOUDFLARE_API_TOKEN --env production
   gh secret list --env production
   account_id="$(jq -e -r .CLOUDFLARE_ACCOUNT_ID <<<"$plaintext")"
   api_token="$(jq -e -r .CLOUDFLARE_API_TOKEN <<<"$plaintext")"
   curl --fail --silent --show-error --config - \
     "https://api.cloudflare.com/client/v4/accounts/$account_id/workers/services/gitzette" \
     <<<"header = \"Authorization: Bearer $api_token\"" |
     jq -e '.success == true' >/dev/null
   unset plaintext account_id api_token
   gh secret delete CLOUDFLARE_ACCOUNT_ID
   gh secret delete CLOUDFLARE_API_TOKEN
   ```

   Do not delete either repository secret unless the environment-secret names
   and the read-only exact-account Worker API check both pass. They are the
   rollback copies until this verification succeeds; the two `gh secret
   delete` commands are the point of no return.

6. Delete the encrypted artifact, delete the migration run logs, and delete
   `CREDENTIAL_MIGRATION_OPEN`. Securely remove the local plaintext and destroy
   the migration private key only after the environment-only credentials pass
   the production preflight.

   ```bash
   migration_dir=/home/tars/.secrets/gitzette-migration-RUN_ID-1
   artifact_id="$(gh api repos/NikolayS/gitzette/actions/runs/RUN_ID/artifacts \
     --jq '.artifacts[] | select(.name == "encrypted-credentials-RUN_ID-1") | .id')"
   gh api --method DELETE "repos/NikolayS/gitzette/actions/artifacts/$artifact_id"
   gh api --method DELETE repos/NikolayS/gitzette/actions/runs/RUN_ID/logs
   gh variable delete CREDENTIAL_MIGRATION_OPEN
   shred -u "$migration_dir/credentials.bin"
   rmdir "$migration_dir"
   shred -u /home/tars/.secrets/gitzette-production-migration-private.pem
   rm -f /home/tars/.secrets/gitzette-production-migration-public.pem
   ```

   Remove `$migration_dir` on any aborted attempt too. Do not destroy the key
   until the functional verification in step 5 has passed.

7. Through the exact-head review gate, delete the migration workflow, its
   temporary environment config/scripts, and the live `credential-migration`
   environment. The normal `production` environment remains restricted to
   release tags throughout this procedure.
   The temporary apply/check scripts intentionally duplicate the established
   production environment reconciler only for this bounded bootstrap; #67
   deletes the duplicate in the same cycle, before normal development resumes.

8. After service restoration, rotate the exported Cloudflare API token through
   a dashboard-authorized session and replace the `production` environment
   secret. The exported token must not remain the long-term credential.
