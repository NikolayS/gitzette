# One-shot production credential migration

This bootstrap moves the existing Cloudflare repository secrets into the
protected `production` environment without exposing plaintext outside GitHub's
secret store and the operator's private local session. The encrypted artifact
is still sensitive: download it immediately, delete it and the run logs after
decryption, and destroy the migration private key after the environment secrets
have been verified.

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

3. Nik approves the pending `credential-migration` deployment. Do not approve
   a rerun or a run whose original dispatcher is not `samo-agent`.

4. Download the exact run's one-day artifact and decrypt locally:

   ```bash
   migration_dir="$(mktemp -d)"
   gh run download RUN_ID --name encrypted-credentials-RUN_ID --dir "$migration_dir"
   openssl pkeyutl -decrypt \
     -inkey /home/tars/.secrets/gitzette-production-migration-private.pem \
     -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 \
     -pkeyopt rsa_mgf1_md:sha256 \
     -in "$migration_dir/credentials.bin" -out "$migration_dir/credentials.json"
   ```

5. Without printing the values, set `CLOUDFLARE_ACCOUNT_ID` and
   `CLOUDFLARE_API_TOKEN` as `production` environment secrets. Verify both names
   exist, then delete the two repository-scoped copies.

6. Delete the encrypted artifact, delete the migration run logs, and delete
   `CREDENTIAL_MIGRATION_OPEN`. Securely remove the local plaintext and destroy
   the migration private key only after the environment-only credentials pass
   the production preflight.

7. Through the exact-head review gate, delete the migration workflow, its
   temporary environment config/scripts, and the live `credential-migration`
   environment. The normal `production` environment remains restricted to
   release tags throughout this procedure.
