# One-shot production credential migration

This bootstrap moves the existing Cloudflare repository secrets into the
protected `production` environment without exposing plaintext outside GitHub's
secret store and the operator's private local session. The encrypted artifact
is still sensitive: download it immediately, delete it and the run logs after
decryption, and destroy the migration private key after the environment secrets
have been verified.

Rotating instead of exporting would be preferable, but it is not available to
this automated recovery: GitHub does not reveal existing secret values, and the
only operator-held Cloudflare token available to the recovery runtime is
D1-only (Workers, schedules, and token-management endpoints return 403), so it
cannot create or replace a Worker-capable production token. A dashboard-authorized token rotation
remains required after service restoration; this exporter exists only to avoid
destroying the sole currently deploy-capable credential before that handoff.

1. From a clean checkout of protected `main`, apply and verify the temporary
   Nik-only environment:

   ```bash
   bash scripts/apply-credential-migration-environment.sh
   ```

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
   `280144521`; it is not a rerun; and the reviewed public-key fingerprint is
   `7067899ede540031e13351ac29297fa51c0dc975f9ed2702d1c4dfe937299cdc`.
   Independently derive that fingerprint from the operator key:

   ```bash
   openssl pkey -in /home/tars/.secrets/gitzette-production-migration-private.pem \
     -pubout -outform DER | sha256sum
   ```

4. Download the exact run's one-day artifact and decrypt locally:

   ```bash
   migration_dir="$(mktemp -d)"
   gh run download RUN_ID --name encrypted-credentials-RUN_ID --dir "$migration_dir"
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
   jq -er .CLOUDFLARE_ACCOUNT_ID <<<"$plaintext" |
     gh secret set CLOUDFLARE_ACCOUNT_ID --env production
   jq -er .CLOUDFLARE_API_TOKEN <<<"$plaintext" |
     gh secret set CLOUDFLARE_API_TOKEN --env production
   unset plaintext
   gh secret list --env production
   gh secret delete CLOUDFLARE_ACCOUNT_ID
   gh secret delete CLOUDFLARE_API_TOKEN
   ```

6. Delete the encrypted artifact, delete the migration run logs, and delete
   `CREDENTIAL_MIGRATION_OPEN`. Securely remove the local plaintext and destroy
   the migration private key only after the environment-only credentials pass
   the production preflight.

   ```bash
   artifact_id="$(gh api repos/NikolayS/gitzette/actions/runs/RUN_ID/artifacts \
     --jq '.artifacts[] | select(.name == "encrypted-credentials-RUN_ID") | .id')"
   gh api --method DELETE "repos/NikolayS/gitzette/actions/artifacts/$artifact_id"
   gh api --method DELETE repos/NikolayS/gitzette/actions/runs/RUN_ID/logs
   gh variable delete CREDENTIAL_MIGRATION_OPEN
   ```

7. Through the exact-head review gate, delete the migration workflow, its
   temporary environment config/scripts, and the live `credential-migration`
   environment. The normal `production` environment remains restricted to
   release tags throughout this procedure.

8. After service restoration, rotate the exported Cloudflare API token through
   a dashboard-authorized session and replace the `production` environment
   secret. The exported token must not remain the long-term credential.
