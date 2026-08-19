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
     gh workflow run migrate-production-credentials.yml --ref main -f operation=export
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
   bash scripts/check-credential-migration-environment.sh
   ```

4. Download the exact run's one-day artifact, decrypt locally, and immediately
   delete the publicly readable remote artifact and run logs. Keep the
   repository secrets as rollback copies:

   ```bash
   migration_dir=/home/tars/.secrets/gitzette-migration-RUN_ID-1
   install -d -m 0700 "$migration_dir"
   gh run download RUN_ID --name encrypted-credentials-RUN_ID-1 --dir "$migration_dir"
   plaintext="$(openssl pkeyutl -decrypt \
     -inkey /home/tars/.secrets/gitzette-production-migration-private.pem \
     -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 \
     -pkeyopt rsa_mgf1_md:sha256 \
     -in "$migration_dir/credentials.bin")"
   artifact_id="$(gh api repos/NikolayS/gitzette/actions/runs/RUN_ID/artifacts \
     --jq '.artifacts[] | select(.name == "encrypted-credentials-RUN_ID-1") | .id')"
   gh api --method DELETE "repos/NikolayS/gitzette/actions/artifacts/$artifact_id"
   gh api --method DELETE repos/NikolayS/gitzette/actions/runs/RUN_ID/logs
   ```

5. Enable `pipefail`. Without printing the values or writing another plaintext
   file, pipe each field from `$plaintext` into `gh secret set --env
   production`. Verify both names and the extracted value against the exact
   Cloudflare account, but do not delete the repository copies yet.

   ```bash
   set -euo pipefail
   account_id="$(jq -j -e -r .CLOUDFLARE_ACCOUNT_ID <<<"$plaintext")"
   api_token="$(jq -j -e -r .CLOUDFLARE_API_TOKEN <<<"$plaintext")"
   [[ -n "$account_id" && -n "$api_token" ]]
   printf '%s' "$account_id" | gh secret set CLOUDFLARE_ACCOUNT_ID --env production
   printf '%s' "$api_token" | gh secret set CLOUDFLARE_API_TOKEN --env production
   gh secret list --env production
   curl --fail --silent --show-error --config - \
     "https://api.cloudflare.com/client/v4/accounts/$account_id/workers/services/gitzette" \
     <<<"header = \"Authorization: Bearer $api_token\"" |
     jq -e '.success == true' >/dev/null
   ```

   Before deletion, enumerate every `secrets.CLOUDFLARE_*` reference under
   `.github/workflows`. `deploy.yml` and the `verify` job must declare
   `environment: production`; the exporter is the sole temporary exception and
   is protected by `credential-migration`.

6. Verify the values GitHub actually stored. Temporarily add `main` to the
   `production` environment while retaining `v*`, Nik-only approval,
   self-review prevention, and `can_admins_bypass: false`; dispatch
   `operation=verify` as `samo-agent`, approve as Nik, and require the run to
   pass. The verify job reads the `production` environment secrets and performs
   the exact-account Worker GET. Remove the temporary `main` policy immediately
   after the run, then delete the repository rollback copies. Those two deletes
   are the point of no return.

   ```bash
   cleanup_production_policy() {
     if [[ -n "${main_policy_id:-}" ]]; then
       gh api --method DELETE \
         "repos/NikolayS/gitzette/environments/production/deployment-branch-policies/$main_policy_id" || true
     fi
     bash scripts/apply-production-environment.sh
     bash scripts/check-production-environment.sh
   }
   trap cleanup_production_policy EXIT
   jq '. | {wait_timer,prevent_self_review,
     reviewers:[.reviewers[]|{type,id}],deployment_branch_policy} |
     . + {can_admins_bypass:false}' config/production-environment.json |
     gh api --method PUT repos/NikolayS/gitzette/environments/production --input -
   main_policy_id="$(gh api --method POST \
     repos/NikolayS/gitzette/environments/production/deployment-branch-policies \
     -f name=main -f type=branch --jq .id)"
   GH_TOKEN="$(gh auth token --user samo-agent)" \
     gh workflow run migrate-production-credentials.yml --ref main -f operation=verify
   # Nik verifies the exact main SHA and approves the pending production deployment.
   gh run watch VERIFY_RUN_ID --exit-status
   cleanup_production_policy
   trap - EXIT
   gh secret delete CLOUDFLARE_ACCOUNT_ID
   gh secret delete CLOUDFLARE_API_TOKEN
   unset plaintext account_id api_token
   ```

7. Delete the switch and local migration material, then destroy the private key
   only after step 6 has passed:

   ```bash
   migration_dir=/home/tars/.secrets/gitzette-migration-RUN_ID-1
   gh variable delete CREDENTIAL_MIGRATION_OPEN
   shred -u "$migration_dir/credentials.bin"
   rmdir "$migration_dir"
   shred -u /home/tars/.secrets/gitzette-production-migration-private.pem
   rm -f /home/tars/.secrets/gitzette-production-migration-public.pem
   ```

   Remove `$migration_dir` on any aborted attempt too. Do not destroy the key
   until the stored-environment verification in step 6 has passed.

8. Through the exact-head review gate, delete the migration workflow, its
   temporary environment config/scripts, and the live `credential-migration`
   environment. Step 6 temporarily admits `main` only for stored-secret
   verification and unconditionally restores the reviewed production policy on
   success, failure, or shell exit.
   The temporary apply/check scripts intentionally duplicate the established
   production environment reconciler only for this bounded bootstrap; #67
   deletes the duplicate in the same cycle, before normal development resumes.

9. After service restoration, rotate the exported Cloudflare API token through
   a dashboard-authorized session and replace the `production` environment
   secret. The exported token must not remain the long-term credential.
