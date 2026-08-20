import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("one-shot credential migration boundary", () => {
  test("pins dispatcher, approvals, encryption, and private transfer storage", async () => {
    const workflow = await Bun.file(".github/workflows/migrate-production-credentials.yml").text();
    const deadlineSources: Array<[string, number]> = [
      [".github/workflows/migrate-production-credentials.yml", 3],
      [".github/workflows/credential-migration-policy-guard.yml", 1],
      ["scripts/apply-credential-migration-environment.sh", 1],
      ["scripts/apply-production-environment.sh", 1],
      ["scripts/check-production-environment.sh", 1],
    ];
    const deadlineValues: string[] = [];
    for (const [path, expectedCount] of deadlineSources) {
      const source = await Bun.file(path).text();
      const values = [...source.matchAll(/20\d\d-\d\d-\d\dT\d\d:\d\d:\d\dZ/g)].map(([value]) => value);
      expect(values).toHaveLength(expectedCount);
      deadlineValues.push(...values);
    }
    expect([...new Set(deadlineValues)]).toEqual(["2026-08-27T00:00:00Z"]);
    const policy = JSON.parse(await Bun.file("config/credential-migration-environment.json").text()) as {
      can_admins_bypass: boolean;
      prevent_self_review: boolean;
      reviewers: Array<{ id: number }>;
      deployment_branch_policy: Record<string, boolean>;
      branch_policies: Array<{ name: string; type: string }>;
    };
    const parsed = Bun.YAML.parse(workflow) as {
      on: Record<string, unknown>;
      concurrency: { group: string; "cancel-in-progress": boolean };
      jobs: Record<string, {
        needs?: string | string[];
        if?: string;
        environment?: string | { name?: unknown };
        permissions?: Record<string, string>;
        steps: Array<{ name?: string; run?: string }>;
      }>;
    };
    expect(Object.keys(parsed.on)).toEqual(["workflow_dispatch"]);
    expect(workflow).toContain("run-name: 'credential migration: ${{ inputs.operation }}'");
    expect(parsed.concurrency).toEqual({ group: "credential-migration", "cancel-in-progress": false });
    expect(workflow).toContain('[[ "$DISPATCHER_ID" != "280144521" ]]');
    expect(workflow).toContain('"$DISPATCH_REF" != "refs/heads/main"');
    expect(workflow).not.toContain("refs/tags/credential-migration-verify");
    expect(workflow).toContain('[[ "$RUN_ATTEMPT" != "1" ]]');
    expect(workflow).toContain("EXPORT_OPEN: ${{ vars.CREDENTIAL_EXPORT_OPEN }}");
    expect(workflow).toContain("VERIFY_OPEN: ${{ vars.CREDENTIAL_VERIFY_OPEN }}");
    expect(workflow).toContain("MIGRATION_OPEN: ${{ vars.CREDENTIAL_EXPORT_OPEN }}");
    expect(workflow).toContain("MIGRATION_OPEN: ${{ vars.CREDENTIAL_VERIFY_OPEN }}");
    expect(workflow.match(/BOOTSTRAP_EXPIRES_AT: 2026-08-27T00:00:00Z/g)).toHaveLength(3);
    expect(workflow).toContain("both production environment credentials must be present");
    expect(workflow).toContain("secrets.PRODUCTION_CLOUDFLARE_ACCOUNT_ID");
    expect(workflow).toContain("secrets.PRODUCTION_CLOUDFLARE_API_TOKEN");
    expect(workflow.match(/secrets\.PRODUCTION_CLOUDFLARE_ACCOUNT_ID/g)).toHaveLength(1);
    expect(workflow.match(/secrets\.PRODUCTION_CLOUDFLARE_API_TOKEN/g)).toHaveLength(1);
    expect(workflow).toContain("both Cloudflare repository secrets must be present");
    expect(workflow).toContain("7067899ede540031e13351ac29297fa51c0dc975f9ed2702d1c4dfe937299cdc");
    expect(workflow).toContain("rsa_mgf1_md:sha256");
    expect(workflow).toContain("credential_migration_transfer");
    expect(workflow).toContain("gitzette-credential-transfer-2026-08");
    expect(workflow).toContain("dedicated D1 transfer storage");
    expect(workflow).toContain("d1/database/$database_id/query");
    const forbiddenDisclosureChannels = [
      "actions/upload-artifact", "actions/cache", "retention-days:", "encrypted_credentials=",
      "set -x", "GITHUB_OUTPUT", "GITHUB_ENV", "GITHUB_STEP_SUMMARY", "::notice", "::warning",
      "credentials.json",
    ];
    for (const channel of forbiddenDisclosureChannels) expect(workflow).not.toContain(channel);
    expect(workflow).toContain("permissions: {}");
    expect(parsed.jobs["export-encrypted-credentials"].needs).toBe("authorize-export");
    expect(parsed.jobs["export-encrypted-credentials"].if).toBe("${{ inputs.operation == 'export' }}");
    expect(parsed.jobs["export-encrypted-credentials"].environment).toBe("credential-migration");
    expect(parsed.jobs["verify-production-credentials"].needs).toBe("authorize-export");
    expect(parsed.jobs["verify-production-credentials"].if).toBe("${{ inputs.operation == 'verify' }}");
    expect(parsed.jobs["verify-production-credentials"].environment).toBe("production");
    expect(parsed.jobs["authorize-export"].permissions).toEqual({ actions: "read", contents: "read" });
    expect(parsed.jobs["export-encrypted-credentials"].permissions).toEqual({ actions: "read", contents: "read" });
    expect(parsed.jobs["verify-production-credentials"].permissions).toEqual({ actions: "read", contents: "read" });
    expect(workflow).not.toContain("earliest credential export run");
    expect(workflow).not.toContain("display_title == \"credential migration: export\"");
    for (const name of ["export-encrypted-credentials", "verify-production-credentials"]) {
      const jobRun = parsed.jobs[name].steps.map(({ run }) => run ?? "").join("\n");
      expect(jobRun).toContain('triggering_actor_id="$(curl');
      expect(jobRun).toContain('[[ "$triggering_actor_id" != "280144521" ]]');
      expect(jobRun).toContain(`/actions/runs/$GITHUB_RUN_ID/approvals`);
      expect(jobRun).toContain('.state == "approved" and .user.id == 1345402');
    }
    expect(policy.can_admins_bypass).toBe(false);
    expect(policy.prevent_self_review).toBe(true);
    expect(policy.reviewers.map(({ id }) => id)).toEqual([1345402]);
    expect(policy.branch_policies).toEqual([{ name: "main", type: "branch" }]);
    expect(policy.deployment_branch_policy).toEqual({ protected_branches: false, custom_branch_policies: true });
    const productionPolicy = JSON.parse(await Bun.file("config/production-environment.json").text()) as {
      can_admins_bypass: boolean;
      prevent_self_review: boolean;
      reviewers: Array<{ id: number }>;
      branch_policies: Array<{ name: string; type: string }>;
    };
    expect(productionPolicy.can_admins_bypass).toBe(false);
    expect(productionPolicy.prevent_self_review).toBe(true);
    expect(productionPolicy.reviewers.map(({ id }) => id)).toEqual([1345402]);
    expect(productionPolicy.branch_policies).toEqual([
      { name: "main", type: "branch" }, { name: "v*", type: "tag" },
    ]);
    const applyProduction = await Bun.file("scripts/apply-production-environment.sh").text();
    const checkProduction = await Bun.file("scripts/check-production-environment.sh").text();
    const guardedShellScripts = [
      "apply-branch-protection.sh",
      "apply-branch-protection.test.sh",
      "apply-credential-migration-environment.sh",
      "apply-production-environment.sh",
      "check-branch-protection.sh",
      "check-branch-protection-nonadmin.sh",
      "check-branch-protection-policy-file.sh",
      "check-credential-migration-environment.sh",
      "check-credential-migration-inventory.sh",
      "check-production-environment.sh",
      "check-release-review-evidence.sh",
      "check-release-tag-actor.sh",
      "check-reviewer-credential-isolation.sh",
      "get-github-environment.sh",
      "install-image-validation-runtime.sh",
      "merge-reviewed-head.sh",
      "merge-reviewed-head.test.sh",
      "run-samorev-review.sh",
      "run-samorev-review.test.sh",
    ];
    for (const name of guardedShellScripts) {
      const source = await Bun.file(`scripts/${name}`).text();
      expect(source).toContain(`${name} must be executed by path, not sourced or piped to Bash`);
      expect(await Bun.spawn(["bash", "-c", `source scripts/${name}`], {
        cwd: process.cwd(), stdout: "pipe", stderr: "pipe",
      }).exited).toBe(1);
    }
    expect(applyProduction).not.toContain("{wait_timer,can_admins_bypass");
    expect(applyProduction).toContain('check-production-environment.sh"');
    expect(applyProduction).toContain("post_apply_environment");
    expect(applyProduction).toContain("unable to re-read production environment after apply");
    expect(applyProduction).toContain("production was newly created");
    expect(checkProduction).toContain("can_admins_bypass: $environment.can_admins_bypass");
    expect(checkProduction).toContain("admitted refs: $policy_names");

    const encoded = workflow.match(/^\s*RSA_PUBLIC_KEY_PEM_B64:\s*(\S+)$/m)?.[1];
    expect(encoded).toBeDefined();
    const publicKey = createPublicKey(Buffer.from(encoded ?? "", "base64"));
    expect(publicKey.asymmetricKeyType).toBe("rsa");
    expect(publicKey.asymmetricKeyDetails?.modulusLength).toBe(4096);
    const fingerprint = createHash("sha256")
      .update(publicKey.export({ type: "spki", format: "der" }))
      .digest("hex");
    expect(fingerprint).toBe("7067899ede540031e13351ac29297fa51c0dc975f9ed2702d1c4dfe937299cdc");
    const migrationDoc = await Bun.file("docs/credential-migration.md").text();
    const productionMigrationDoc = await Bun.file("docs/production-migrations.md").text();
    const readme = await Bun.file("README.md").text();
    const documentedFingerprints = migrationDoc.match(/[0-9a-f]{64}/g) ?? [];
    expect(documentedFingerprints.length).toBeGreaterThan(0);
    expect([...new Set(documentedFingerprints)]).toEqual([fingerprint]);
    expect(migrationDoc).toContain("set -euo pipefail");
    expect(migrationDoc).toContain("umask 077");
    expect(migrationDoc).toContain("-v2 aes-256-cbc -v2prf hmacWithSHA256 -iter 600000");
    expect(migrationDoc).toContain("-----BEGIN ENCRYPTED PRIVATE KEY-----");
    expect(migrationDoc).toContain("-passin pass:");
    expect(migrationDoc.indexOf('[[ "$actual_fingerprint" != "$expected_fingerprint" ]]')).toBeLessThan(
      migrationDoc.indexOf('shred -u "$private_key"'),
    );
    expect(migrationDoc.indexOf('[[ "$actual_fingerprint" != "$expected_fingerprint" ]]')).toBeLessThan(
      migrationDoc.indexOf('-pubout -out "$MIGRATION_KEY_DIR/production-migration-public.pem"'),
    );
    expect(migrationDoc).toContain("must be tmpfs or an operator-verified encrypted volume");
    expect(migrationDoc).toContain("$MIGRATION_KEY_DIR/production-migration-private.pem");
    expect(migrationDoc).not.toContain("/home/tars/");
    expect(migrationDoc).toContain("token_count=\"$(grep -c");
    expect(migrationDoc).not.toContain("export CLOUDFLARE_API_TOKEN");
    expect(migrationDoc).toContain("concurrency only\n   serializes accidental duplicates");
    const exportSwitchOffsets = [...migrationDoc.matchAll(/gh variable set CREDENTIAL_EXPORT_OPEN/g)]
      .map((match) => match.index);
    expect(exportSwitchOffsets).toHaveLength(2);
    let previousExportSwitchOffset = -1;
    for (const exportSwitchOffset of exportSwitchOffsets) {
      const precedingWindow = migrationDoc.slice(previousExportSwitchOffset + 1, exportSwitchOffset);
      expect(precedingWindow).toContain("bash scripts/check-credential-migration-environment.sh");
      expect(precedingWindow).toContain("bash scripts/check-credential-migration-inventory.sh");
      previousExportSwitchOffset = exportSwitchOffset;
    }
    expect(migrationDoc.indexOf("gh variable delete CREDENTIAL_EXPORT_OPEN")).toBeLessThan(
      migrationDoc.lastIndexOf('operator_token_file="${OPERATOR_TOKEN_FILE'),
    );
    expect(migrationDoc).toContain("gh variable set CREDENTIAL_VERIFY_OPEN --body true");
    expect(migrationDoc.lastIndexOf("bash scripts/check-production-environment.sh", migrationDoc.indexOf("gh variable set CREDENTIAL_VERIFY_OPEN"))).toBeGreaterThan(-1);
    expect(migrationDoc).toContain("gh variable delete CREDENTIAL_VERIFY_OPEN");
    expect(migrationDoc).toContain("only clean closed state is an absent variable");
    expect(migrationDoc.indexOf("gh secret delete CLOUDFLARE_ACCOUNT_ID")).toBeLessThan(
      migrationDoc.indexOf("--ref main -f operation=verify"),
    );
    expect(migrationDoc).toContain("remaining_repository_cloudflare_secrets");
    expect(migrationDoc).toContain(".total_rows == 1 and .expected_rows == 1 and .other_rows == 0");
    expect(migrationDoc).toContain("export_started_epoch - clock_skew_seconds");
    expect(migrationDoc).toContain("export_completed_epoch + clock_skew_seconds");
    expect(migrationDoc).toContain('transfer_rowid <<<"$selected_row"');
    expect(migrationDoc).toContain('transfer_created_at <<<"$selected_row"');
    expect(migrationDoc).toContain('ciphertext <<<"$selected_row"');
    expect(migrationDoc).toContain('== "$snapshot_ciphertext"');
    expect(migrationDoc).toContain("min(ciphertext) as transfer_ciphertext");
    expect(migrationDoc).toContain("RSA does not authenticate the\nstored row");
    const recoveryConclusionOffset = migrationDoc.indexOf('(.conclusion == "success" or .conclusion == "failure")');
    const recoveryRunOffset = migrationDoc.lastIndexOf('export_run="$(gh run view', recoveryConclusionOffset);
    const recoveryCloseOffset = migrationDoc.lastIndexOf("gh variable delete CREDENTIAL_EXPORT_OPEN", recoveryConclusionOffset);
    const recoveryInventoryOffset = migrationDoc.indexOf("bash scripts/check-credential-migration-inventory.sh", recoveryCloseOffset);
    expect(recoveryRunOffset).toBeGreaterThan(-1);
    expect(recoveryCloseOffset).toBeGreaterThan(recoveryRunOffset);
    expect(recoveryCloseOffset).toBeLessThan(recoveryConclusionOffset);
    expect(recoveryInventoryOffset).toBeGreaterThan(recoveryCloseOffset);
    expect(recoveryInventoryOffset).toBeLessThan(recoveryConclusionOffset);
    expect(migrationDoc).toContain("repository-secret fallback structurally impossible");
    expect(migrationDoc).toContain("GitHub pins the workflow\n   run to the immutable `main` SHA at dispatch");
    expect(migrationDoc).toContain("Production is temporarily widened");
    expect(migrationDoc).toContain("migration-policy` is expected red with exit 4");
    expect(migrationDoc).toContain("D1 `/query` contract accepts either a single");
    expect(productionMigrationDoc).not.toContain("CREDENTIAL_MIGRATION_IN_PROGRESS");
    expect(migrationDoc).toContain("Production migration and schema commands remain unchanged and strict");
    expect(readme).not.toContain("CREDENTIAL_MIGRATION_IN_PROGRESS");
    expect(migrationDoc).toContain("#67 restores the `v*`-only policy");
    expect(migrationDoc).toContain("guard intentionally reports any early tightening as drift");
    expect(migrationDoc).toContain("credential-migration environment sub-block from the permanent\n   `policy-api-readability` job");
    expect(migrationDoc).toContain("retain that job,\n   its production-environment probe, and its required status-check entry");
    for (const schemaGate of [
      "scripts/check-production-applied-schema.sh",
      "scripts/check-production-drift.sh",
      "scripts/check-production-schema.sh",
    ]) {
      const gate = await Bun.file(schemaGate).text();
      expect(gate).not.toContain("credential_migration");
    }
    expect(await Bun.file("scripts/credential-migration-schema-exclusion.sh").exists()).toBe(false);
    expect(workflow).not.toContain("CREDENTIAL_MIGRATION_IN_PROGRESS");
    const deployWorkflow = await Bun.file(".github/workflows/deploy.yml").text();
    expect(deployWorkflow).not.toContain("CREDENTIAL_MIGRATION_IN_PROGRESS");
    expect(workflow).toContain("curl --fail-with-body --silent --show-error");
    expect(migrationDoc).toContain("On any abort or operator");
    expect(migrationDoc.indexOf("[[ \"$verify_status\" == 0 ]]")).toBeLessThan(
      migrationDoc.lastIndexOf("--request DELETE"),
    );
    expect(migrationDoc).toContain(': "${POLICY_GUARD_RUN_ID:?new preflight guard run was not observed}"');
    expect(migrationDoc).toContain(': "${RUN_ID:?set the exact export run ID}"');
    expect(migrationDoc).toContain(': "${VERIFY_RUN_ID:?new verification run was not observed}"');
    const installStart = migrationDoc.indexOf("5. Without printing");
    const verifyStart = migrationDoc.indexOf("6. From a clean checkout");
    const verifyEnd = migrationDoc.indexOf("7. After successful read-capability verification");
    expect(installStart).toBeGreaterThanOrEqual(0);
    expect(verifyStart).toBeGreaterThan(installStart);
    expect(verifyEnd).toBeGreaterThan(verifyStart);
    const installStep = migrationDoc.slice(installStart, verifyStart);
    const verifyStep = migrationDoc.slice(verifyStart, verifyEnd);
    expect(installStep).not.toContain("VERIFY_RUN_ID");
    expect(verifyStep).toContain('previous_verify_run_id="$(gh run list');
    expect(verifyStep).toContain('gh run watch "$VERIFY_RUN_ID"');
    expect(verifyStep.indexOf(': "${plaintext:?re-run the post-decryption restore block')).toBeLessThan(
      verifyStep.indexOf("gh variable set CREDENTIAL_VERIFY_OPEN"),
    );
    expect(verifyStep.indexOf('if [[ "$verify_status" != 0 ]]')).toBeLessThan(
      verifyStep.indexOf("gh variable delete CREDENTIAL_VERIFY_OPEN"),
    );
    expect(verifyStep.indexOf("gh secret set CLOUDFLARE_API_TOKEN")).toBeLessThan(
      verifyStep.indexOf("gh variable delete CREDENTIAL_VERIFY_OPEN"),
    );
    expect(migrationDoc).toContain('previous_guard_run_id="$(gh run list');
    expect(migrationDoc).toContain("stopped between\n   table creation and insert");
    expect(migrationDoc).toContain("dispatch_export_recovery empty-table");
    expect(migrationDoc).toContain("dispatch_export_recovery absent-table");
    expect(migrationDoc).toContain("never leave CREDENTIAL_EXPORT_OPEN set for more than five minutes");
    expect(migrationDoc).toContain("the deadline only turns the migration and guard workflows red and does not\n   narrow the live environment automatically");
    expect(migrationDoc).toContain("scripts/production-environment-policy.test.ts");
    expect(await Bun.file("scripts/production-environment-policy.test.ts").exists()).toBe(true);
    expect(migrationDoc).toContain("Production D1 REST batch preflight OK");
    expect(migrationDoc).toContain('application_database_id="4a3624d7-7de8-46d5-91f5-7ee79856ccaa"');
    expect(migrationDoc).toContain("unset application_database_id d1_token");
    expect(migrationDoc.match(/\[\[ "\$database_id" != "4a3624d7-7de8-46d5-91f5-7ee79856ccaa" \]\]/g)?.length).toBe(2);
    expect(migrationDoc).toContain('{sql:"select ?1 as bound",params:["probe"]}');
    expect(migrationDoc).toContain('.result[1].results == [{bound:"probe"}]');
    expect(migrationDoc).toContain("select count(*) as total from sqlite_schema");
    expect(migrationDoc).toContain("dedicated D1 database created by the one-shot export");
    expect(migrationDoc).toContain("never bound to the public Worker");
    expect(migrationDoc).toContain('account_id="a3265e0d0db71fdece29365819452f00"');
    expect(migrationDoc).toContain('d1_token="$(sed -n');
    expect(migrationDoc).toContain("table-count.json select.json count.json");
    expect(migrationDoc).toContain("INCIDENT_RECORD_FILE");
    expect(migrationDoc).toContain("outside\n   `MIGRATION_KEY_DIR`");
    expect(migrationDoc).toContain('for retained_run_dir in "$MIGRATION_KEY_DIR"/run-*-1');
    expect(migrationDoc).not.toContain('>>"$migration_dir/incident.log"');
    expect(migrationDoc).toContain("sqlite_schema where type = \\u0027table\\u0027");
    expect(migrationDoc.indexOf("mandatory smoke test both succeed")).toBeLessThan(
      migrationDoc.indexOf('shred -u "$MIGRATION_KEY_DIR/production-migration-private.pem"'),
    );
    expect(migrationDoc).toContain("select.json count.json");
    expect(migrationDoc).toContain("separate switch\n   guard is expected red during an open export switch");
    expect(migrationDoc).toContain("dedicated child Bash process");
    expect(migrationDoc).toContain("unset HISTFILE; set +o history");
    expect(migrationDoc).toContain("Each violation must exit nonzero");
    for (const teardownItem of [
      "credential-migration-policy-guard.yml", "credential-migration-switch-guard.yml",
      "credential-migration-environment.json",
      "credential-migration-gate.test.ts",
      "check-credential-migration-inventory.sh",
      "scripts/apply-production-environment.sh",
      "scripts/check-production-environment.sh",
      "CREDENTIAL_EXPORT_OPEN", "CREDENTIAL_VERIFY_OPEN",
    ]) expect(migrationDoc).toContain(teardownItem);
    expect(migrationDoc).toContain("Retain `scripts/get-github-environment.sh`");
    expect(migrationDoc).toContain("repository Actions variables must be empty and repository Actions secrets\n   may contain only the reviewed `CLAUDE_CODE_OAUTH_TOKEN` after migration");
    expect(migrationDoc).toContain("production-policy` job is expected red");
    expect(migrationDoc).not.toContain("environment_credentials_ready");
    expect(migrationDoc).toContain('environment_secrets_before="$(gh api');
    expect(migrationDoc).not.toContain("secret_write_started");
    expect(migrationDoc).toContain('map(select(.name == $current.name))');
    expect(migrationDoc).toContain('.updated_at // "") <');
    expect(migrationDoc).not.toContain('.updated_at // "") <=');
    const postCleanupStart = migrationDoc.indexOf("After cleanup,\n   re-run the inventory audit");
    const postCleanupEnd = migrationDoc.indexOf("The migration workflow fails closed", postCleanupStart);
    const postCleanup = migrationDoc.slice(postCleanupStart, postCleanupEnd);
    expect(postCleanup).toContain("bash scripts/check-credential-migration-inventory.sh");
    expect(postCleanup).toContain("gh workflow run credential-migration-policy-guard.yml --ref main");
    expect(postCleanup).toContain("gh workflow run credential-migration-switch-guard.yml --ref main");
    expect(postCleanup).toContain('gh run watch "$CLEANUP_GUARD_RUN_ID" --exit-status');
    expect(postCleanup).toContain('gh run watch "$CLEANUP_SWITCH_GUARD_RUN_ID" --exit-status');
    expect(postCleanup).toContain("repository-scoped\n   switch residue");
    expect(postCleanup).toContain("environment-scoped\n   credential inventory");

    const policyGuard = await Bun.file(".github/workflows/credential-migration-policy-guard.yml").text();
    const switchGuard = await Bun.file(".github/workflows/credential-migration-switch-guard.yml").text();
    const parsedPolicyGuard = Bun.YAML.parse(policyGuard) as {
      on: { schedule: Array<{ cron: string }> };
      permissions: Record<string, string>;
      jobs: Record<string, { permissions: Record<string, string>; steps: Array<{ name?: string; run?: string; uses?: string; with?: Record<string, unknown> }> }>;
    };
    const parsedSwitchGuard = Bun.YAML.parse(switchGuard) as typeof parsedPolicyGuard;
    expect(parsedPolicyGuard.on.schedule).toEqual([{ cron: "*/5 * * * *" }]);
    expect(parsedSwitchGuard.on.schedule).toEqual([{ cron: "2-59/5 * * * *" }]);
    expect(policyGuard).toContain("bash scripts/check-production-environment.sh");
    expect(policyGuard).toContain("bash scripts/check-credential-migration-environment.sh");
    expect(policyGuard).toContain("CRITICAL: production ref policy is outside the reviewed deadline-bound main plus release-tag policy");
    expect(policyGuard).toContain("GUARD UNREADABLE: production environment API evidence could not be retrieved");
    expect(policyGuard).toContain("CRITICAL: production environment is missing");
    expect(policyGuard).toContain("CRITICAL: credential-migration no longer requires Nik-only approval with self-review blocked");
    expect(policyGuard).toContain('[[ "$REPOSITORY" == "NikolayS/gitzette" ]]');
    expect(policyGuard).not.toContain("github.event.repository.fork");
    expect(policyGuard).not.toContain("CREDENTIAL_EXPORT_OPEN");
    expect(policyGuard).not.toContain("CREDENTIAL_VERIFY_OPEN");
    expect(switchGuard).toContain("EXPORT_OPEN: ${{ vars.CREDENTIAL_EXPORT_OPEN }}");
    expect(switchGuard).toContain("VERIFY_OPEN: ${{ vars.CREDENTIAL_VERIFY_OPEN }}");
    expect(switchGuard).toContain('a credential migration switch remains defined');
    expect(policyGuard).toContain("BOOTSTRAP_EXPIRES_AT: 2026-08-27T00:00:00Z");
    expect(policyGuard).toContain("credential bootstrap deadline expired");
    expect(policyGuard).not.toContain("  migration-switches:");
    expect(policyGuard).not.toContain("if: ${{ github.repository == 'NikolayS/gitzette' }}");
    expect(parsedPolicyGuard.permissions).toEqual({});
    expect(parsedPolicyGuard.jobs["production-policy"].permissions).toEqual({ actions: "read", contents: "read" });
    expect(Object.keys(parsedPolicyGuard.jobs)).toEqual([
      "production-policy", "migration-policy", "bootstrap-deadline",
    ]);
    expect(parsedPolicyGuard.jobs["migration-policy"].permissions).toEqual({ actions: "read", contents: "read" });
    expect(parsedPolicyGuard.jobs["bootstrap-deadline"].permissions).toEqual({});
    expect(parsedSwitchGuard.permissions).toEqual({});
    expect(Object.keys(parsedSwitchGuard.jobs)).toEqual(["migration-switches"]);
    expect(parsedSwitchGuard.jobs["migration-switches"].permissions).toEqual({});
    for (const jobName of ["production-policy", "migration-policy"]) {
      const checkout = parsedPolicyGuard.jobs[jobName].steps.find(({ uses }) => uses?.startsWith("actions/checkout@"));
      expect(checkout?.with).toEqual({ "persist-credentials": false, ref: "main" });
    }
    const policyGuardRun = parsedPolicyGuard.jobs["production-policy"].steps.find(({ name }) =>
      name?.startsWith("Audit the fixed production ref policy"))?.run;
    const productionRepositoryPinRun = parsedPolicyGuard.jobs["production-policy"].steps.find(({ name }) =>
      name === "Require the canonical repository")?.run;
    const migrationGuardRun = parsedPolicyGuard.jobs["migration-policy"].steps.find(({ name }) =>
      name?.startsWith("Audit the credential migration approval boundary"))?.run;
    const migrationPolicyRepositoryPinRun = parsedPolicyGuard.jobs["migration-policy"].steps.find(({ name }) =>
      name === "Require the canonical repository")?.run;
    const migrationSwitchRun = parsedSwitchGuard.jobs["migration-switches"].steps.find(({ name }) =>
      name?.startsWith("Fail if a credential migration switch remains open"))?.run;
    const migrationRepositoryPinRun = parsedSwitchGuard.jobs["migration-switches"].steps.find(({ name }) =>
      name === "Require the canonical repository")?.run;
    const deadlineRepositoryPinRun = parsedPolicyGuard.jobs["bootstrap-deadline"].steps.find(({ name }) =>
      name === "Require the canonical repository")?.run;
    const deadlineRun = parsedPolicyGuard.jobs["bootstrap-deadline"].steps.find(({ name }) =>
      name === "Enforce the credential bootstrap deadline")?.run;
    expect(productionRepositoryPinRun).toBeDefined();
    expect(policyGuardRun).toBeDefined();
    expect(migrationGuardRun).toBeDefined();
    expect(migrationPolicyRepositoryPinRun).toBeDefined();
    expect(migrationSwitchRun).toBeDefined();
    expect(migrationRepositoryPinRun).toBeDefined();
    expect(deadlineRepositoryPinRun).toBeDefined();
    expect(deadlineRun).toBeDefined();
    const policyGuardRoot = await mkdtemp(join(tmpdir(), "gitzette-policy-guard-run-"));
    const fakeBash = join(policyGuardRoot, "bash");
    await Bun.write(fakeBash, `#!/bin/sh
exit "\${FAKE_CHECKER_STATUS:-0}"
`);
    await Bun.spawn(["chmod", "+x", fakeBash]).exited;
    const executeRepositoryPin = (run: string | undefined, repository: string): Promise<number> =>
      Bun.spawn(["/bin/bash", "-c", run ?? "exit 99"], {
        cwd: process.cwd(),
        env: { ...process.env, REPOSITORY: repository },
        stdout: "pipe", stderr: "pipe",
      }).exited;
    for (const run of [productionRepositoryPinRun, migrationPolicyRepositoryPinRun, migrationRepositoryPinRun, deadlineRepositoryPinRun]) {
      expect(await executeRepositoryPin(run, "NikolayS/gitzette")).toBe(0);
      expect(await executeRepositoryPin(run, "attacker/gitzette")).toBe(1);
    }
    const executePolicyGuard = (checkerStatus: number): Promise<number> => Bun.spawn([
      "/bin/bash", "-c", policyGuardRun ?? "exit 99",
    ], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${policyGuardRoot}:${process.env.PATH}`, FAKE_CHECKER_STATUS: String(checkerStatus) },
      stdout: "pipe", stderr: "pipe",
    }).exited;
    expect(await executePolicyGuard(0)).toBe(0);
    expect(await executePolicyGuard(1)).toBe(1);
    expect(await executePolicyGuard(3)).toBe(3);
    expect(await executePolicyGuard(4)).toBe(4);
    const executeMigrationGuard = (checkerStatus: number): Promise<number> => Bun.spawn([
      "/bin/bash", "-c", migrationGuardRun ?? "exit 99",
    ], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${policyGuardRoot}:${process.env.PATH}`, FAKE_CHECKER_STATUS: String(checkerStatus) },
      stdout: "pipe", stderr: "pipe",
    }).exited;
    expect(await executeMigrationGuard(0)).toBe(0);
    expect(await executeMigrationGuard(1)).toBe(1);
    expect(await executeMigrationGuard(3)).toBe(3);
    expect(await executeMigrationGuard(4)).toBe(4);
    const executeMigrationSwitchGuard = (exportOpen: string, verifyOpen: string): Promise<number> =>
      Bun.spawn(["/bin/bash", "-c", migrationSwitchRun ?? "exit 99"], {
        cwd: process.cwd(),
        env: { ...process.env, EXPORT_OPEN: exportOpen, VERIFY_OPEN: verifyOpen },
        stdout: "pipe", stderr: "pipe",
      }).exited;
    expect(await executeMigrationSwitchGuard("", "")).toBe(0);
    expect(await executeMigrationSwitchGuard("true", "")).toBe(1);
    expect(await executeMigrationSwitchGuard("false", "")).toBe(1);
    expect(await executeMigrationSwitchGuard("", "true")).toBe(1);
    expect(await executeMigrationSwitchGuard("", "false")).toBe(1);
    const fakeDate = join(policyGuardRoot, "date");
    await Bun.write(fakeDate, `#!/bin/bash
set -euo pipefail
if [[ "$*" == "-u +%s" ]]; then printf '%s\\n' "$FAKE_NOW"; exit 0; fi
if [[ "$1" == -u && "$2" == -d && "$4" == +%s ]]; then
  [[ "$FAKE_DEADLINE" != invalid ]] || exit 7
  printf '%s\\n' "$FAKE_DEADLINE"
  exit 0
fi
exit 8
`);
    await Bun.spawn(["chmod", "+x", fakeDate]).exited;
    const executeDeadline = (now: string, deadline: string): Promise<number> =>
      Bun.spawn(["/bin/bash", "-c", deadlineRun ?? "exit 99"], {
        cwd: process.cwd(),
        env: {
          ...process.env, PATH: `${policyGuardRoot}:${process.env.PATH}`,
          BOOTSTRAP_EXPIRES_AT: "2026-08-27T00:00:00Z",
          FAKE_NOW: now, FAKE_DEADLINE: deadline,
        },
        stdout: "pipe", stderr: "pipe",
      }).exited;
    expect(await executeDeadline("100", "200")).toBe(0);
    expect(await executeDeadline("200", "200")).toBe(1);
    expect(await executeDeadline("200", "100")).toBe(1);
    expect(await executeDeadline("100", "invalid")).not.toBe(0);

    const deploy = await Bun.file(".github/workflows/deploy.yml").text();
    expect(deploy).toContain("tags:\n      - 'v*'");
    expect(deploy).not.toContain("workflow_dispatch");
    expect(deploy).not.toContain("${{ secrets.CLOUDFLARE_");
    expect(deploy.match(/secrets\.PRODUCTION_CLOUDFLARE_ACCOUNT_ID/g)).toHaveLength(5);
    expect(deploy.match(/secrets\.PRODUCTION_CLOUDFLARE_API_TOKEN/g)).toHaveLength(5);
    expect(migrationDoc).toContain("gh secret set PRODUCTION_CLOUDFLARE_ACCOUNT_ID --env production");
    expect(migrationDoc).toContain("gh secret set PRODUCTION_CLOUDFLARE_API_TOKEN --env production");
    const productionConsumers: string[] = [];
    const repositoryCredentialConsumers: string[] = [];
    const reusableWorkflowCredentialConsumers: string[] = [];
    for await (const name of new Bun.Glob("*.{yml,yaml}").scan(".github/workflows")) {
      const path = `.github/workflows/${name}`;
      const parsedWorkflow = Bun.YAML.parse(await Bun.file(path).text()) as {
        jobs?: Record<string, { environment?: unknown; [key: string]: unknown }>;
      };
      for (const [jobName, job] of Object.entries(parsedWorkflow.jobs ?? {})) {
        const environment = job.environment === undefined ? undefined
          : typeof job.environment === "string"
          ? job.environment
          : typeof job.environment === "object" && job.environment !== null &&
              typeof (job.environment as { name?: unknown }).name === "string"
            ? (job.environment as { name: string }).name
            : undefined;
        if (job.environment !== undefined) {
          expect(environment, `${path} job ${jobName} must use a literal environment name`).toBeDefined();
          expect(environment).not.toContain("${{");
        }
        if (environment === "production") productionConsumers.push(path);
        const reusableWorkflowCredentialConsumer = job.uses !== undefined && job.secrets !== undefined;
        if (reusableWorkflowCredentialConsumer) reusableWorkflowCredentialConsumers.push(`${path}:${jobName}`);
        if (/secrets\.(?:PRODUCTION_)?CLOUDFLARE_/.test(JSON.stringify(job)) || reusableWorkflowCredentialConsumer) {
          const repositoryExporter = path === ".github/workflows/migrate-production-credentials.yml" &&
            jobName === "export-encrypted-credentials";
          expect(
            environment === "production" || repositoryExporter,
            `${path} job ${jobName} must use production or be the reviewed one-shot exporter`,
          ).toBe(true);
          if (repositoryExporter) repositoryCredentialConsumers.push(`${path}:${jobName}`);
        }
      }
    }
    expect([...new Set(productionConsumers)].sort()).toEqual([
      ".github/workflows/deploy.yml",
      ".github/workflows/migrate-production-credentials.yml",
    ]);
    expect(repositoryCredentialConsumers).toEqual([
      ".github/workflows/migrate-production-credentials.yml:export-encrypted-credentials",
    ]);
    expect(reusableWorkflowCredentialConsumers).toEqual([]);

    const authorizeRun = parsed.jobs["authorize-export"].steps.find(({ name }) => name?.startsWith("Require"))?.run;
    const revalidateRun = parsed.jobs["export-encrypted-credentials"].steps.find(({ name }) => name?.startsWith("Revalidate"))?.run;
    const exportRun = parsed.jobs["export-encrypted-credentials"].steps.find(({ name }) => name?.startsWith("Export encrypted"))?.run;
    const verifyApprovalRun = parsed.jobs["verify-production-credentials"].steps.find(({ name }) => name?.startsWith("Require"))?.run;
    const verifyCredentialsRun = parsed.jobs["verify-production-credentials"].steps.find(({ name }) => name?.startsWith("Verify stored"))?.run;
    expect(authorizeRun).toBeDefined();
    expect(revalidateRun).toBeDefined();
    expect(exportRun).toBeDefined();
    expect(verifyApprovalRun).toBeDefined();
    expect(verifyCredentialsRun).toBeDefined();
    const gateRoot = await mkdtemp(join(tmpdir(), "gitzette-migration-gate-"));
    const gateBin = join(gateRoot, "bin");
    await mkdir(gateBin);
    const date = join(gateBin, "date");
    await Bun.write(date, `#!/usr/bin/env bash
set -euo pipefail
if [[ " $* " == *" -d "* ]]; then
  printf '1787788800\n'
elif [[ "\${FAKE_BOOTSTRAP_EXPIRED:-false}" == true ]]; then
  printf '1787788800\n'
else
  printf '1787788799\n'
fi
`);
    const curl = join(gateBin, "curl");
    await Bun.write(curl, `#!/usr/bin/env bash
set -euo pipefail
arguments="$*"
if [[ -n "\${FAKE_CURL_RECORD:-}" ]]; then printf '%s\\n' "$@" >>"$FAKE_CURL_RECORD.args"; cat >>"$FAKE_CURL_RECORD.stdin"; else cat >/dev/null; fi
[[ "\${FAKE_CURL_FAIL:-false}" != true ]] || exit 22
if [[ "$arguments" == *'/approvals'* ]]; then
  if [[ "\${FAKE_APPROVAL_EMPTY:-false}" == true ]]; then printf '[]\\n'; else
    printf '[{"state":"%s","user":{"id":%s},"environments":[{"name":"%s"}]}]\\n' "\${FAKE_APPROVAL_STATE:-approved}" "\${FAKE_APPROVER_ID:-1345402}" "\${FAKE_APPROVAL_ENV:-credential-migration}"
  fi
elif [[ "$arguments" == *'/actions/runs/'* ]]; then
  printf '{"triggering_actor":{"id":%s}}\\n' "\${FAKE_ACTOR_ID:-280144521}"
elif [[ "$arguments" == *'/commits/main'* ]]; then
  printf '{"sha":"%s"}\\n' "\${FAKE_MAIN_SHA:-exact-sha}"
elif [[ "$arguments" == *'/d1/database' && "$arguments" != *'/query'* ]]; then
  printf '{"success":true,"result":{"name":"%s","uuid":"%s"}}\\n' \
    "\${TRANSFER_DATABASE_NAME:-gitzette-credential-transfer-2026-08}" \
    "\${FAKE_DATABASE_ID:-11111111-2222-3333-4444-555555555555}"
else
  printf '{"success":%s,"result":[{"success":%s},{"success":%s,"meta":{"changes":%s}}]}\\n' \
    "\${FAKE_CF_SUCCESS:-true}" "\${FAKE_CF_SUCCESS:-true}" "\${FAKE_CF_SUCCESS:-true}" "\${FAKE_D1_CHANGES:-1}"
fi
`);
    await Bun.spawn(["chmod", "+x", date, curl]).exited;
    const execute = async (run: string | undefined, overrides: Record<string, string | undefined> = {}): Promise<number> => {
      const env: Record<string, string> = {
        ...process.env,
        PATH: `${gateBin}:${process.env.PATH}`,
        DISPATCHER_ID: "280144521",
        DISPATCH_REF: "refs/heads/main",
        RUN_ATTEMPT: "1",
        OPERATION: "export",
        EXPORT_OPEN: "true",
        VERIFY_OPEN: "false",
        MIGRATION_OPEN: "true",
        BOOTSTRAP_EXPIRES_AT: "2026-08-27T00:00:00Z",
        GH_TOKEN: "fake",
        GITHUB_REPOSITORY: "example/gitzette",
        GITHUB_RUN_ID: "77",
        GITHUB_SHA: "exact-sha",
        DISPATCH_SHA: "exact-sha",
      };
      for (const [name, value] of Object.entries(overrides)) {
        if (value === undefined) delete env[name]; else env[name] = value;
      }
      return Bun.spawn(["bash", "-c", run ?? "exit 99"], { env, stdout: "pipe", stderr: "pipe" }).exited;
    };
    for (const run of [authorizeRun, revalidateRun]) {
      expect(await execute(run)).toBe(0);
      expect(await execute(run, { DISPATCHER_ID: "1" })).toBe(1);
      expect(await execute(run, { DISPATCH_REF: "refs/heads/other" })).toBe(1);
      expect(await execute(run, { RUN_ATTEMPT: "2" })).toBe(1);
    }
    expect(await execute(authorizeRun, { EXPORT_OPEN: undefined })).toBe(1);
    expect(await execute(authorizeRun, { EXPORT_OPEN: "True" })).toBe(1);
    expect(await execute(authorizeRun, { EXPORT_OPEN: "true " })).toBe(1);
    expect(await execute(authorizeRun, { FAKE_ACTOR_ID: "1" })).toBe(1);
    expect(await execute(authorizeRun, { GITHUB_SHA: "stale" })).toBe(1);
    expect(await execute(revalidateRun, { MIGRATION_OPEN: undefined })).toBe(1);
    expect(await execute(revalidateRun, { MIGRATION_OPEN: "True" })).toBe(1);
    expect(await execute(revalidateRun, { MIGRATION_OPEN: "true " })).toBe(1);
    expect(await execute(authorizeRun, { OPERATION: "attacker" })).toBe(1);
    expect(await execute(revalidateRun, { FAKE_ACTOR_ID: "1" })).toBe(1);
    expect(await execute(revalidateRun, { FAKE_APPROVER_ID: "1" })).toBe(1);
    expect(await execute(revalidateRun, { FAKE_APPROVAL_ENV: "other" })).toBe(1);
    expect(await execute(revalidateRun, { FAKE_APPROVAL_STATE: "rejected" })).toBe(1);
    expect(await execute(revalidateRun, { FAKE_APPROVAL_EMPTY: "true" })).toBe(1);
    expect(await execute(revalidateRun, { DISPATCH_SHA: "stale" })).toBe(1);
    expect(await execute(authorizeRun, { FAKE_BOOTSTRAP_EXPIRED: "true" })).toBe(1);
    expect(await execute(revalidateRun, { FAKE_BOOTSTRAP_EXPIRED: "true" })).toBe(1);
    const curlRecord = join(gateRoot, "curl-record");
    expect(await execute(revalidateRun, { FAKE_CURL_RECORD: curlRecord })).toBe(0);
    const curlArgs = await Bun.file(`${curlRecord}.args`).text();
    const curlStdin = await Bun.file(`${curlRecord}.stdin`).text();
    expect(curlArgs).toContain("--config\n-\n");
    expect(curlArgs).toContain("https://api.github.com/repos/example/gitzette/actions/runs/77");
    expect(curlArgs).toContain("https://api.github.com/repos/example/gitzette/actions/runs/77/approvals");
    expect(curlArgs).not.toContain("fake");
    expect(curlStdin.match(/header = "Authorization: Bearer fake"/g)?.length).toBe(3);
    expect(await execute(revalidateRun, { FAKE_CURL_FAIL: "true" })).not.toBe(0);
    const verify = { OPERATION: "verify", DISPATCH_REF: "refs/heads/main", VERIFY_OPEN: "true", FAKE_APPROVAL_ENV: "production" };
    expect(await execute(authorizeRun, verify)).toBe(0);
    expect(await execute(authorizeRun, { ...verify, VERIFY_OPEN: undefined })).toBe(1);
    expect(await execute(authorizeRun, { ...verify, VERIFY_OPEN: "True" })).toBe(1);
    expect(await execute(authorizeRun, { ...verify, VERIFY_OPEN: "true " })).toBe(1);
    expect(await execute(authorizeRun, { ...verify, EXPORT_OPEN: "false" })).toBe(0);
    expect(await execute(authorizeRun, { ...verify, GITHUB_SHA: "stale" })).toBe(1);
    expect(await execute(verifyApprovalRun, verify)).toBe(0);
    expect(await execute(verifyApprovalRun, { ...verify, FAKE_APPROVAL_ENV: "other" })).toBe(1);
    expect(await execute(verifyApprovalRun, { ...verify, FAKE_APPROVER_ID: "1" })).toBe(1);
    expect(await execute(verifyApprovalRun, { ...verify, FAKE_APPROVAL_STATE: "rejected" })).toBe(1);
    expect(await execute(verifyApprovalRun, { ...verify, FAKE_APPROVAL_EMPTY: "true" })).toBe(1);
    expect(await execute(verifyApprovalRun, { ...verify, MIGRATION_OPEN: "false" })).toBe(1);
    expect(await execute(verifyApprovalRun, { ...verify, DISPATCH_REF: "refs/heads/other" })).toBe(1);
    expect(await execute(verifyApprovalRun, { ...verify, DISPATCH_SHA: "stale" })).toBe(1);
    expect(await execute(verifyApprovalRun, { ...verify, FAKE_BOOTSTRAP_EXPIRED: "true" })).toBe(1);
    expect(await execute(verifyCredentialsRun, {
      CLOUDFLARE_ACCOUNT_ID: "a3265e0d0db71fdece29365819452f00", CLOUDFLARE_API_TOKEN: "exact-token",
    })).toBe(0);
    expect(await execute(verifyCredentialsRun, {
      CLOUDFLARE_ACCOUNT_ID: "a3265e0d0db71fdece29365819452f00", CLOUDFLARE_API_TOKEN: "exact-token", FAKE_CF_SUCCESS: "false",
    })).not.toBe(0);
    expect(await execute(verifyCredentialsRun, {
      CLOUDFLARE_ACCOUNT_ID: "other-account", CLOUDFLARE_API_TOKEN: "exact-token",
    })).not.toBe(0);
    expect(await execute(verifyCredentialsRun, {
      CLOUDFLARE_ACCOUNT_ID: "", CLOUDFLARE_API_TOKEN: "exact-token",
    })).toBe(1);
    expect(await execute(verifyCredentialsRun, {
      CLOUDFLARE_ACCOUNT_ID: "a3265e0d0db71fdece29365819452f00", CLOUDFLARE_API_TOKEN: undefined,
    })).toBe(1);

    const throwaway = generateKeyPairSync("rsa", { modulusLength: 4096 });
    const throwawayPublicPem = throwaway.publicKey.export({ type: "spki", format: "pem" }).toString();
    const throwawayPublicDer = throwaway.publicKey.export({ type: "spki", format: "der" });
    const throwawayFingerprint = createHash("sha256").update(throwawayPublicDer).digest("hex");
    const throwawayRoot = await mkdtemp(join(tmpdir(), "gitzette-migration-export-"));
    const privatePath = join(throwawayRoot, "private.pem");
    await Bun.write(privatePath, throwaway.privateKey.export({ type: "pkcs8", format: "pem" }));
    const executableExport = (exportRun ?? "exit 99").replace(fingerprint, throwawayFingerprint);
    const exportEnv = {
      ...process.env,
      RUNNER_TEMP: throwawayRoot,
      RSA_PUBLIC_KEY_PEM_B64: Buffer.from(throwawayPublicPem).toString("base64"),
      CLOUDFLARE_ACCOUNT_ID: "a3265e0d0db71fdece29365819452f00",
      CLOUDFLARE_API_TOKEN: "exact-token",
      TRANSFER_DATABASE_NAME: "gitzette-credential-transfer-2026-08",
      GITHUB_RUN_ID: "77",
      PATH: `${gateBin}:${process.env.PATH}`,
    };
    expect(await Bun.spawn(["bash", "-c", executableExport], { env: exportEnv, stdout: "pipe", stderr: "pipe" }).exited).toBe(0);
    expect(await Bun.spawn(["bash", "-c", executableExport], {
      env: { ...exportEnv, CLOUDFLARE_ACCOUNT_ID: "wrong-account" }, stdout: "pipe", stderr: "pipe",
    }).exited).toBe(1);
    expect(await Bun.spawn(["bash", "-c", executableExport], {
      env: { ...exportEnv, FAKE_D1_CHANGES: "0" }, stdout: "pipe", stderr: "pipe",
    }).exited).toBe(1);
    const encryptedPath = join(throwawayRoot, "gitzette-credential-migration", "credentials.bin");
    const decrypted = Bun.spawnSync({
      cmd: ["openssl", "pkeyutl", "-decrypt", "-inkey", privatePath,
        "-pkeyopt", "rsa_padding_mode:oaep", "-pkeyopt", "rsa_oaep_md:sha256", "-pkeyopt", "rsa_mgf1_md:sha256",
        "-in", encryptedPath],
      stdout: "pipe", stderr: "pipe",
    });
    expect(decrypted.exitCode).toBe(0);
    const decryptedPlaintext = new TextDecoder().decode(decrypted.stdout);
    expect(JSON.parse(decryptedPlaintext)).toEqual({
      CLOUDFLARE_ACCOUNT_ID: "a3265e0d0db71fdece29365819452f00",
      CLOUDFLARE_API_TOKEN: "exact-token",
    });
    expect(migrationDoc).not.toContain('<<<"$plaintext"');
    expect(migrationDoc).toContain('export TMPDIR="$MIGRATION_KEY_DIR"');
    expect(migrationDoc).toContain('export RUN_ID="${RUN_ID:?set the exact retained export run ID}"');
    expect(migrationDoc).toContain('[[ "$(stat -Lc %u "$smoke_path")" == "$(id -u)" ]]');
    expect(migrationDoc.indexOf('chmod go-w "$smoke_path"')).toBeLessThan(
      migrationDoc.indexOf("bash /tmp/gl-dispatch/dispatch/smoke-test.sh"),
    );
    const plaintextAccessors = [...migrationDoc.matchAll(
      /printf '%s' "\$plaintext" \| jq -j -e -r (\.[A-Za-z_][A-Za-z0-9_]*)/g,
    )].map((match) => match[1] ?? "");
    expect(plaintextAccessors).toHaveLength(4);
    expect(new Set(plaintextAccessors)).toEqual(new Set([
      ".CLOUDFLARE_ACCOUNT_ID",
      ".CLOUDFLARE_API_TOKEN",
    ]));
    for (const accessor of plaintextAccessors) {
      const extracted = Bun.spawnSync({
        cmd: ["jq", "-j", "-e", "-r", accessor],
        stdin: new TextEncoder().encode(decryptedPlaintext),
        stdout: "pipe", stderr: "pipe",
      });
      expect(extracted.exitCode).toBe(0);
      expect(new TextDecoder().decode(extracted.stdout)).toBe(
        accessor === ".CLOUDFLARE_ACCOUNT_ID"
          ? "a3265e0d0db71fdece29365819452f00"
          : "exact-token",
      );
    }
    expect(exportRun).not.toContain('--arg api_token "$CLOUDFLARE_API_TOKEN"');
    expect(exportRun).not.toContain('--arg account_id "$CLOUDFLARE_ACCOUNT_ID"');
    expect(exportRun).not.toContain("--retry");
    expect(JSON.parse(await Bun.file(join(throwawayRoot, "gitzette-credential-migration", "create-database.json")).text())).toEqual({
      name: "gitzette-credential-transfer-2026-08",
    });
    const d1Request = JSON.parse(await Bun.file(join(throwawayRoot, "gitzette-credential-migration", "d1-request.json")).text());
    expect(Object.keys(d1Request)).toEqual(["batch"]);
    expect(d1Request.batch).toHaveLength(2);
    expect(d1Request.batch[0].sql).toContain("create table credential_migration_transfer");
    expect(d1Request.batch[0].sql).not.toContain("if not exists");
    expect(d1Request.batch[0].params).toBeUndefined();
    expect(d1Request.batch[1].sql).toContain("insert into credential_migration_transfer");
    expect(d1Request.batch[1].sql).toContain("datetime('now')");
    expect(d1Request.batch[1].sql).toContain("where not exists");
    expect(d1Request.batch[1].params[0]).toBe("77");
    expect(d1Request.batch[1].params[1]).toBe(Buffer.from(await Bun.file(encryptedPath).arrayBuffer()).toString("base64"));
    const transferDb = new Database(":memory:");
    for (const statement of d1Request.batch) {
      transferDb.prepare(statement.sql).run(...(statement.params ?? []));
    }
    expect(transferDb.query("select run_id, ciphertext, created_at from credential_migration_transfer").get()).toEqual({
      run_id: "77",
      ciphertext: d1Request.batch[1].params[1],
      created_at: expect.any(String),
    });
    transferDb.prepare(d1Request.batch[1].sql).run("88", "second-ciphertext");
    expect(transferDb.query("select count(*) as total from credential_migration_transfer").get()).toEqual({ total: 1 });
    expect(() => {
      for (const statement of d1Request.batch) {
        transferDb.prepare(statement.sql).run(...(statement.params ?? []));
      }
    }).toThrow();
    transferDb.close();
    expect(await Bun.spawn(["bash", "-c", executableExport], {
      env: { ...exportEnv, FAKE_DATABASE_ID: "4a3624d7-7de8-46d5-91f5-7ee79856ccaa" }, stdout: "pipe", stderr: "pipe",
    }).exited).toBe(1);
    expect(await Bun.spawn(["bash", "-c", executableExport], {
      env: { ...exportEnv, CLOUDFLARE_API_TOKEN: "" }, stdout: "pipe", stderr: "pipe",
    }).exited).toBe(1);
    expect(await Bun.spawn(["bash", "-c", exportRun ?? "exit 99"], {
      env: exportEnv, stdout: "pipe", stderr: "pipe",
    }).exited).toBe(1);
  });

  test("compiles every operational runbook block and jq filter", async () => {
    const migrationDoc = await Bun.file("docs/credential-migration.md").text();
    const bashBlocks = [...migrationDoc.matchAll(/^[ \t]*```bash[ \t]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm)]
      .map((match) => match[1] ?? "");
    expect(bashBlocks).toHaveLength(15);

    const runbookRoot = await mkdtemp(join(tmpdir(), "gitzette-migration-runbook-"));
    try {
      for (const [index, block] of bashBlocks.entries()) {
        const path = join(runbookRoot, `block-${index}.sh`);
        await Bun.write(path, block);
        const syntax = Bun.spawn(["bash", "-n", path], { stdout: "pipe", stderr: "pipe" });
        const [status, stderr] = await Promise.all([
          syntax.exited,
          new Response(syntax.stderr).text(),
        ]);
        expect(status, `runbook Bash block ${index + 1} failed to parse: ${stderr}`).toBe(0);
      }

      const shell = bashBlocks.join("\n");
      const invocationCount = [...shell.matchAll(/\bjq\b/g)].length;
      const quotedPrograms = [...shell.matchAll(/\bjq\b(?:[^\n']|\\\n)*'([\s\S]*?)'/g)]
        .map((match) => match[1] ?? "");
      const unquotedPrograms = [...shell.matchAll(/(?:\bjq\b(?:\s+-[A-Za-z]+)+|--jq)\s+(\.[A-Za-z_][A-Za-z0-9_.]*)\b/g)]
        .map((match) => match[1] ?? "");
      const jqPrograms = [...quotedPrograms, ...unquotedPrograms];
      expect(jqPrograms, "every runbook jq invocation must expose one statically compilable filter")
        .toHaveLength(invocationCount);

      for (const [index, program] of jqPrograms.entries()) {
        const compile = Bun.spawn([
          "jq", "-n", "--argjson", "before", "[]", "--arg", "run_id", "1",
          "--arg", "release_sha", "a".repeat(40),
          `def runbook_program: (${program}); empty`,
        ], { stdout: "pipe", stderr: "pipe" });
        const [status, stderr] = await Promise.all([
          compile.exited,
          new Response(compile.stderr).text(),
        ]);
        expect(status, `runbook jq filter ${index + 1} failed to compile: ${stderr}`).toBe(0);
      }
    } finally {
      await rm(runbookRoot, { recursive: true, force: true });
    }
  });

  test("closes both migration switches idempotently on operator re-entry", async () => {
    const migrationDoc = await Bun.file("docs/credential-migration.md").text();
    const execute = (closeSwitch: string, deleteStatus: string, remaining: string): Promise<number> => Bun.spawn([
      "bash", "-c", `set -euo pipefail
gh() {
  if [[ "$1 $2" == "variable delete" ]]; then return "$FAKE_DELETE_STATUS"; fi
  if [[ "$1 $2" == "variable list" ]]; then printf '%s\\n' "$FAKE_REMAINING"; return 0; fi
  return 91
}
${closeSwitch}`,
    ], {
      env: { ...process.env, FAKE_DELETE_STATUS: deleteStatus, FAKE_REMAINING: remaining },
      stdout: "pipe", stderr: "pipe",
    }).exited;
    for (const [migrationSwitch, expectedCount] of [
      ["CREDENTIAL_EXPORT_OPEN", 2],
      ["CREDENTIAL_VERIFY_OPEN", 2],
    ] as const) {
      const closePattern = new RegExp(
        `if ! gh variable delete ${migrationSwitch}[\\s\\S]*?\\n[ \\t]*fi`,
        "g",
      );
      const closes = migrationDoc.match(closePattern) ?? [];
      expect(closes).toHaveLength(expectedCount);
      for (const closeSwitch of closes) {
        expect(await execute(closeSwitch, "0", "1")).toBe(0);
        expect(await execute(closeSwitch, "1", "0")).toBe(0);
        expect(await execute(closeSwitch, "1", "1")).toBe(1);
      }
    }
  });

  test("executes the required policy API readability gate fail closed", async () => {
    const ciSource = await Bun.file(".github/workflows/ci.yml").text();
    const ci = Bun.YAML.parse(ciSource) as {
      jobs: Record<string, {
        "timeout-minutes"?: number;
        permissions?: Record<string, string>;
        steps: Array<{ name?: string; run?: string }>;
      }>;
    };
    const jobName = "policy-api-readability";
    const job = ci.jobs[jobName];
    expect(job).toBeDefined();
    expect(job["timeout-minutes"]).toBe(2);
    expect(job.permissions).toEqual({ actions: "read", contents: "read" });
    expect(ci.jobs.typecheck?.["timeout-minutes"]).toBe(30);
    const imageRuntime = ci.jobs.typecheck?.steps.find(({ name }) => name === "Install image validation runtime")?.run ?? "";
    expect(imageRuntime).toBe("bash scripts/install-image-validation-runtime.sh");
    const aptHarnessRoot = await mkdtemp(join(tmpdir(), "gitzette-apt-runtime-"));
    const aptBin = join(aptHarnessRoot, "bin");
    await mkdir(aptBin);
    await Bun.write(join(aptBin, "sudo"), `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  sed) [[ "\${FAKE_SUDO_MODE:-normal}" != no-op-sed ]] || exit 0 ;;
  cp) [[ "\${FAKE_SUDO_MODE:-normal}" != copy-error ]] || exit 23 ;;
  apt-get|install) printf '%s\\n' "$*" >>"$FAKE_SUDO_RECORD"; exit 0 ;;
esac
exec "$@"
`);
    await Bun.write(join(aptBin, "grep"), `#!/usr/bin/env bash
set -euo pipefail
[[ "\${FAKE_SUDO_MODE:-normal}" != grep-error ]] || exit 2
exec /usr/bin/grep "$@"
`);
    await Bun.spawn(["chmod", "+x", join(aptBin, "sudo"), join(aptBin, "grep")]).exited;
    const executeImageRuntime = async (
      fixture: string,
      options: { mode?: string; skipInstall?: boolean } = {},
    ): Promise<{ status: number; source: string; record: string }> => {
      const aptRoot = join(aptHarnessRoot, fixture);
      await mkdir(aptRoot);
      const source = join(aptRoot, "sources.list");
      const record = join(aptRoot, "sudo-record");
      await Bun.write(source, "deb https://azure.archive.ubuntu.com/ubuntu noble main\n");
      await Bun.write(record, "");
      const env = {
        ...process.env,
        PATH: `${aptBin}:${process.env.PATH}`,
        APT_ROOT: aptRoot,
        FAKE_SUDO_MODE: options.mode ?? "normal",
        FAKE_SUDO_RECORD: record,
        ...(options.skipInstall ? { APT_SKIP_INSTALL: "true" } : {}),
      };
      const status = await Bun.spawn(["bash", "scripts/install-image-validation-runtime.sh"], {
        cwd: process.cwd(), env, stdout: "pipe", stderr: "pipe",
      }).exited;
      return { status, source: await Bun.file(source).text(), record: await Bun.file(record).text() };
    };
    const aptSuccess = await executeImageRuntime("success");
    expect(aptSuccess.status).toBe(0);
    expect(aptSuccess.source).toContain("https://archive.ubuntu.com/ubuntu");
    expect(aptSuccess.source).not.toContain("azure.archive.ubuntu.com");
    expect(aptSuccess.record).toContain("apt-get update");
    expect(aptSuccess.record).toContain("apt-get install -y");
    expect(aptSuccess.record).toContain("install -o root -g root -m 0644");
    expect((await executeImageRuntime("no-op", { mode: "no-op-sed", skipInstall: true })).status).toBe(1);
    expect((await executeImageRuntime("grep-error", { mode: "grep-error", skipInstall: true })).status).toBe(2);
    expect((await executeImageRuntime("copy-error", { mode: "copy-error", skipInstall: true })).status).toBe(23);
    const runBlock = job.steps.find(({ name }) => name === "Prove policy guard API readability")?.run;
    expect(runBlock).toBeDefined();
    const protection = JSON.parse(await Bun.file("config/main-branch-protection.json").text()) as {
      required_status_checks: { checks: Array<{ context: string }> };
    };
    expect(protection.required_status_checks.checks.filter(({ context }) => context === jobName)).toHaveLength(1);
    expect(ciSource).toContain("bash scripts/check-branch-protection-policy-file.sh config/main-branch-protection.json");
    const branchPolicyValidator = await Bun.file("scripts/check-branch-protection-policy-file.sh").text();
    expect(branchPolicyValidator).toContain('.repository_rulesets[0].target == "branch"');
    expect(branchPolicyValidator).toContain('.repository_rulesets[0].conditions.ref_name == {"exclude":[],"include":["refs/heads/main"]}');

    const root = await mkdtemp(join(tmpdir(), "gitzette-policy-api-readability-"));
    const gh = join(root, "gh");
    await Bun.write(gh, `#!/usr/bin/env bash
set -euo pipefail
endpoint=""
for argument in "$@"; do
  [[ "$argument" != repos/* ]] || endpoint="$argument"
done
case "$endpoint" in
  repos/NikolayS/gitzette/environments/production)
    [[ "\${FAKE_MODE:-ok}" != production-error ]] || { echo forbidden >&2; exit 1; }
    custom=true
    [[ "\${FAKE_MODE:-ok}" != production-custom-false ]] || custom=false
    if [[ "\${FAKE_MODE:-ok}" == production-field-missing ]]; then
      jq -nc --argjson custom "$custom" '{deployment_branch_policy:{custom_branch_policies:$custom}}'
    else
      jq -nc --argjson custom "$custom" '{can_admins_bypass:false,deployment_branch_policy:{custom_branch_policies:$custom}}'
    fi
    ;;
  repos/NikolayS/gitzette/environments/production/deployment-branch-policies*)
    [[ "\${FAKE_MODE:-ok}" != production-policies-error ]] || { echo forbidden >&2; exit 1; }
    printf '{"branch_policies":[]}\n'
    ;;
  repos/NikolayS/gitzette/environments?per_page=100)
    [[ "\${FAKE_MODE:-ok}" != inventory-error ]] || { echo forbidden >&2; exit 1; }
    if [[ "\${FAKE_MODE:-ok}" == ok-no-migration ]]; then
      printf '[{"environments":[]}]\n'
    else
      printf '[{"environments":[{"name":"credential-migration"}]}]\n'
    fi
    ;;
  repos/NikolayS/gitzette/environments/credential-migration)
    [[ "\${FAKE_MODE:-ok}" != migration-error ]] || { echo forbidden >&2; exit 1; }
    custom=false
    [[ "\${FAKE_MODE:-ok}" != ok-custom-true && "\${FAKE_MODE:-ok}" != migration-policies-error ]] || custom=true
    if [[ "\${FAKE_MODE:-ok}" == migration-field-missing ]]; then
      jq -nc --argjson custom "$custom" '{deployment_branch_policy:{custom_branch_policies:$custom}}'
    else
      jq -nc --argjson custom "$custom" '{can_admins_bypass:false,deployment_branch_policy:{custom_branch_policies:$custom}}'
    fi
    ;;
  repos/NikolayS/gitzette/environments/credential-migration/deployment-branch-policies*)
    [[ "\${FAKE_MODE:-ok}" != migration-policies-error ]] || { echo forbidden >&2; exit 1; }
    printf '{"branch_policies":[]}\n'
    ;;
  *) echo "unexpected endpoint: $endpoint" >&2; exit 91 ;;
esac
`);
    await Bun.spawn(["chmod", "+x", gh]).exited;
    const execute = (mode: string, repository = "NikolayS/gitzette", isForkPr = "false"): Promise<number> => Bun.spawn(["bash", "-c", runBlock ?? "exit 99"], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${root}:${process.env.PATH}`, GITHUB_REPOSITORY: repository, IS_FORK_PR: isForkPr, FAKE_MODE: mode },
      stdout: "pipe", stderr: "pipe",
    }).exited;
    expect(await execute("production-error", "fork/gitzette")).toBe(0);
    expect(await execute("production-error", "NikolayS/gitzette", "true")).toBe(0);
    expect(await execute("ok-no-migration")).toBe(0);
    expect(await execute("production-custom-false")).toBe(0);
    expect(await execute("ok-custom-false")).toBe(0);
    expect(await execute("ok-custom-true")).toBe(0);
    for (const mode of [
      "production-error", "production-field-missing", "production-policies-error",
      "inventory-error", "migration-error", "migration-field-missing", "migration-policies-error",
    ]) expect(await execute(mode)).not.toBe(0);
  });

  test("keeps one fixed production ref policy and fails drift loud", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitzette-production-policy-mode-"));
    const bin = join(root, "bin");
    await mkdir(bin);
    const gh = join(bin, "gh");
    await Bun.write(gh, `#!/usr/bin/env bash
set -euo pipefail
endpoint="\${*: -1}"
case "$endpoint" in
  repos/example/gitzette/environments/production)
    case "\${FAKE_API_ERROR:-none}" in
      auth) echo "fake production API failure" >&2; exit 1 ;;
      missing)
        [[ "$*" != *--include* ]] || printf 'HTTP/2.0 404 Not Found\r\n\r\n{"message":"Not Found"}\n'
        echo "gh: Not Found (HTTP 404)" >&2; exit 1
        ;;
    esac
    bypass=false; [[ "\${FAKE_API_ERROR:-none}" != bypass ]] || bypass=true
    protected=false; custom=true
    reviewers='[{"type":"User","reviewer":{"id":1345402,"login":"NikolayS"}}]'
    jq -nc --argjson bypass "$bypass" --argjson protected "$protected" --argjson custom "$custom" --argjson reviewers "$reviewers" '{can_admins_bypass:$bypass,protection_rules:[{type:"required_reviewers",prevent_self_review:true,reviewers:$reviewers}],deployment_branch_policy:{protected_branches:$protected,custom_branch_policies:$custom}}'
    ;;
  *environments?per_page=100) printf '%s\n' '[{"environments":[]}]' ;;
  *deployment-branch-policies*)
    if [[ "\${FAKE_LIVE_POLICY:-default}" == api-error ]]; then
      echo "fake branch policy API failure" >&2
      exit 1
    elif [[ "\${FAKE_LIVE_POLICY:-default}" == empty ]]; then
      printf '%s\\n' '[{"branch_policies":[]}]'
    elif [[ "\${FAKE_LIVE_POLICY:-default}" == v-only ]]; then
      printf '%s\\n' '[{"branch_policies":[{"name":"v*","type":"tag"}]}]'
    else
      printf '%s\\n' '[{"branch_policies":[{"name":"main","type":"branch"},{"name":"v*","type":"tag"}]}]'
    fi
    ;;
  *) exit 91 ;;
esac
`);
    await Bun.spawn(["chmod", "+x", gh]).exited;
    const date = join(bin, "date");
    await Bun.write(date, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *" -d "* ]]; then printf '100\\n'; else printf '%s\\n' "\${FAKE_NOW_EPOCH:-99}"; fi
`);
    await Bun.spawn(["chmod", "+x", date]).exited;
    const run = async (live: string, apiError = "none", nowEpoch = "99"): Promise<{ code: number; stdout: string; stderr: string }> => {
      const child = Bun.spawn(["bash", "scripts/check-production-environment.sh"], {
        cwd: process.cwd(),
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: "example/gitzette", FAKE_LIVE_POLICY: live, FAKE_API_ERROR: apiError, FAKE_NOW_EPOCH: nowEpoch },
        stdout: "pipe", stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
      ]);
      return { code, stdout, stderr };
    };
    const normal = await run("default");
    expect(normal.code).toBe(0);
    expect(normal.stdout).toContain("admitted refs: main, v*");
    const expiredWidened = await run("default", "none", "100");
    expect(expiredWidened.code).toBe(1);
    const expiredNarrowed = await run("v-only", "none", "100");
    expect(expiredNarrowed.code).toBe(0);
    expect(expiredNarrowed.stdout).toContain("admitted refs: v*");
    const empty = await run("empty");
    expect(empty.code).toBe(1);
    expect(empty.stderr).toContain('"branch_policies":[]');
    const policyApiFailure = await run("api-error");
    expect(policyApiFailure.code).toBe(3);
    expect(policyApiFailure.stderr).toContain("unable to read production deployment branch policies");
    const apiFailure = await run("default", "auth");
    expect(apiFailure.code).toBe(3);
    expect(apiFailure.stderr).toContain("unable to read production environment");
    expect(apiFailure.stderr).toContain("fake production API failure");
    const missing = await run("default", "missing");
    expect(missing.code).toBe(4);
    expect(missing.stderr).toContain("production environment is missing; run scripts/apply-production-environment.sh");
    expect(missing.stderr).toContain("absent from the readable repository inventory");
    const bypass = await run("default", "bypass");
    expect(bypass.code).toBe(1);
    expect(bypass.stderr).toContain('disable "Allow administrators to bypass configured protection rules"');
    expect(bypass.stderr).toContain("environment production");
  });

  test("applies the fixed main and release-tag policy idempotently", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitzette-production-policy-apply-"));
    const bin = join(root, "bin");
    await mkdir(bin);
    const state = join(root, "policies.json");
    await Bun.write(state, '[{"id":10,"name":"v*","type":"tag"},{"id":11,"name":"v*","type":"tag"}]');
    const gh = join(bin, "gh");
    await Bun.write(gh, `#!/usr/bin/env bash
set -euo pipefail
method=GET; endpoint=""; name=""; type=""
for argument in "$@"; do
  [[ "$argument" != PUT && "$argument" != POST && "$argument" != DELETE ]] || method="$argument"
  [[ "$argument" != repos/* ]] || endpoint="$argument"
  [[ "$argument" != name=* ]] || name="\${argument#name=}"
  [[ "$argument" != type=* ]] || type="\${argument#type=}"
done
case "$method:$endpoint" in
  PUT:repos/example/gitzette/environments/production) printf x >>"$FAKE_STATE.put-count"; cat >"$FAKE_STATE.put" ;;
  GET:repos/example/gitzette/environments/production)
    if [[ "\${FAKE_CREATE:-false}" == true && ! -f "$FAKE_STATE.put" ]]; then
      if [[ "$*" == *--include* ]]; then printf 'HTTP/2.0 404 Not Found\r\n\r\n{"message":"Not Found"}\n'; fi
      exit 1
    fi
    bypass=false; [[ "\${FAKE_ADMIN_BYPASS:-false}" != true ]] || bypass=true
    [[ "\${FAKE_CREATE:-false}" != true ]] || bypass=true
    policy='{"protected_branches":false,"custom_branch_policies":true}'
    reviewers='[{"type":"User","reviewer":{"id":1345402,"login":"NikolayS"}}]'
    [[ ! -f "$FAKE_STATE.put" ]] || policy="$(jq -c .deployment_branch_policy "$FAKE_STATE.put")"
    if [[ -f "$FAKE_STATE.put" ]]; then
      reviewers="$(jq -c '[.reviewers[] | {type,reviewer:{id,login:(if .id == 1345402 then "NikolayS" else "samo-agent" end)}}]' "$FAKE_STATE.put")"
    fi
    jq -nc --argjson bypass "$bypass" --argjson policy "$policy" --argjson reviewers "$reviewers" '{can_admins_bypass:$bypass,protection_rules:[{type:"required_reviewers",prevent_self_review:true,reviewers:$reviewers}],deployment_branch_policy:$policy}'
    ;;
  GET:*environments?per_page=100) printf '[{"environments":[]}]\n' ;;
  GET:*deployment-branch-policies*) jq -c '[{branch_policies:.}]' "$FAKE_STATE" ;;
  POST:*deployment-branch-policies*)
    printf '%s:%s\n' "$name" "$type" >>"$FAKE_STATE.post-log"
    next_id="$(jq '[.[].id] | max + 1' "$FAKE_STATE")"
    jq --argjson id "$next_id" --arg name "$name" --arg type "$type" '. + [{id:$id,name:$name,type:$type}]' "$FAKE_STATE" >"$FAKE_STATE.next"
    mv "$FAKE_STATE.next" "$FAKE_STATE"
    ;;
  DELETE:*deployment-branch-policies/*)
    id="\${endpoint##*/}"
    jq --argjson id "$id" 'map(select(.id != $id))' "$FAKE_STATE" >"$FAKE_STATE.next"
    mv "$FAKE_STATE.next" "$FAKE_STATE"
    ;;
  *) exit 91 ;;
esac
`);
    await Bun.spawn(["chmod", "+x", gh]).exited;
    const date = join(bin, "date");
    await Bun.write(date, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *" -d "* ]]; then printf '100\\n'; else printf '%s\\n' "\${FAKE_NOW_EPOCH:-99}"; fi
`);
    await Bun.spawn(["chmod", "+x", date]).exited;
    const run = async (adminBypass = false, create = false, nowEpoch = "99", restoreBaseline = false): Promise<number> => Bun.spawn([
      "bash", "scripts/apply-production-environment.sh", ...(restoreBaseline ? ["--restore-baseline"] : []),
    ], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: "example/gitzette", FAKE_STATE: state, FAKE_ADMIN_BYPASS: String(adminBypass), FAKE_CREATE: String(create), FAKE_NOW_EPOCH: nowEpoch },
      stdout: "pipe", stderr: "pipe",
    }).exited;
    expect(await run()).toBe(0);
    expect(JSON.parse(await Bun.file(`${state}.put`).text()).can_admins_bypass).toBeUndefined();
    expect(JSON.parse(await Bun.file(state).text()).map(({ name }: { name: string }) => name).sort()).toEqual(["main", "v*"]);
    expect(await Bun.file(`${state}.put-count`).text()).toBe("x");
    expect(await run(true)).toBe(1);
    expect(await Bun.file(`${state}.put-count`).text()).toBe("x");
    await rm(`${state}.put`, { force: true });
    await rm(`${state}.put-count`, { force: true });
    expect(await run(false, true)).toBe(1);
    expect(await Bun.file(`${state}.put-count`).text()).toBe("x");
    expect(await run(false, false, "100")).toBe(1);
    expect(await Bun.file(`${state}.put-count`).text()).toBe("x");
    await rm(`${state}.post-log`, { force: true });
    expect(await run(false, false, "100", true)).toBe(0);
    expect(await Bun.file(`${state}.put-count`).text()).toBe("xx");
    expect(JSON.parse(await Bun.file(state).text()).map(({ name }: { name: string }) => name)).toEqual(["v*"]);
    expect(await Bun.file(`${state}.post-log`).exists()).toBe(false);
    expect(await run(false, false, "100", true)).toBe(0);
    expect(await Bun.file(`${state}.put-count`).text()).toBe("xxx");
    expect(JSON.parse(await Bun.file(state).text()).map(({ name }: { name: string }) => name)).toEqual(["v*"]);
    expect(await Bun.file(`${state}.post-log`).exists()).toBe(false);

    const applySource = await Bun.file("scripts/apply-production-environment.sh").text();
    expect(applySource).toContain("temporary production main admission expired");
    expect(applySource).toContain('any(.branch_policies[]?; .name == "main" and .type == "branch")');
    expect(applySource).toContain("--restore-baseline");
    const policyBlock = applySource.slice(
      applySource.indexOf('expected_policies='),
      applySource.lastIndexOf('\nif [[ "$restore_baseline" == true ]]'),
    );
    const protectedPolicy = join(root, "protected-policy.json");
    await Bun.write(protectedPolicy, JSON.stringify({
      deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
      branch_policies: [],
    }));
    const rejectingGh = join(bin, "rejecting-gh");
    await Bun.write(rejectingGh, "#!/usr/bin/env bash\necho unexpected-policy-API-call >&2\nexit 77\n");
    await Bun.spawn(["chmod", "+x", rejectingGh]).exited;
    const protectedBlock = Bun.spawn([
      "bash", "-c", `set -euo pipefail
policy="$FAKE_POLICY"
effective_policy="$(jq -c . "$policy")"
repository=example/gitzette
gh() { "$FAKE_GH" "$@"; }
${policyBlock}`,
    ], {
      cwd: process.cwd(),
      env: { ...process.env, FAKE_POLICY: protectedPolicy, FAKE_GH: rejectingGh },
      stdout: "pipe", stderr: "pipe",
    });
    expect(await protectedBlock.exited).toBe(0);
  });

  test("executes the reviewed environment policy against live-response shapes", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitzette-migration-policy-"));
    const bin = join(root, "bin");
    await mkdir(bin);
    const gh = join(bin, "gh");
    await Bun.write(gh, `#!/usr/bin/env bash
set -euo pipefail
endpoint="\${*: -1}"
case "$endpoint" in
  repos/example/gitzette/environments/credential-migration)
    case "\${FAKE_MODE:-ok}" in
      auth) echo "fake API failure" >&2; exit 1 ;;
      missing)
        [[ "$*" != *--include* ]] || printf 'HTTP/2.0 404 Not Found\r\n\r\n{"message":"Not Found"}\n'
        echo "gh: Not Found (HTTP 404)" >&2; exit 1
        ;;
    esac
    reviewer_id=1345402; reviewer_login=NikolayS; prevent=true; admin_bypass=false; wait_timer=0; protected=false; custom=true
    [[ "\${FAKE_MODE:-ok}" != reviewer ]] || { reviewer_id=280144521; reviewer_login=samo-agent; }
    [[ "\${FAKE_MODE:-ok}" != self-review ]] || prevent=false
    [[ "\${FAKE_MODE:-ok}" != admin-bypass ]] || admin_bypass=true
    [[ "\${FAKE_MODE:-ok}" != wait-timer ]] || wait_timer=5
    [[ "\${FAKE_MODE:-ok}" != protected-branch-policy ]] || { protected=true; custom=false; }
    extra='[]'
    [[ "\${FAKE_MODE:-ok}" != extra-reviewer ]] || extra='[{"type":"User","reviewer":{"id":280144521,"login":"samo-agent"}}]'
    jq -n --argjson id "$reviewer_id" --arg login "$reviewer_login" --argjson prevent "$prevent" \
      --argjson bypass "$admin_bypass" --argjson wait "$wait_timer" --argjson protected "$protected" --argjson custom "$custom" --argjson extra "$extra" '{
      can_admins_bypass:$bypass,
      protection_rules:([{type:"required_reviewers",prevent_self_review:$prevent,reviewers:([{type:"User",reviewer:{id:$id,login:$login}}] + $extra)}] + (if $wait == 0 then [] else [{type:"wait_timer",wait_timer:$wait}] end)),
      deployment_branch_policy:{protected_branches:$protected,custom_branch_policies:$custom}
    }'
    ;;
  *environments?per_page=100) printf '%s\n' '[{"environments":[]}]' ;;
  *deployment-branch-policies*)
    if [[ "\${FAKE_MODE:-ok}" == extra-policy ]]; then
      printf '%s\\n' '[{"branch_policies":[{"name":"main","type":"branch"},{"name":"other","type":"branch"}]}]'
    elif [[ "\${FAKE_MODE:-ok}" == no-policy ]]; then
      printf '%s\\n' '[{"branch_policies":[]}]'
    else
      printf '%s\\n' '[{"branch_policies":[{"name":"main","type":"branch"}]}]'
    fi
    ;;
  *credential-migration/variables*)
    if [[ "\${FAKE_MODE:-ok}" == variable-api-error ]]; then echo 'variable API failed' >&2; exit 1
    elif [[ "\${FAKE_MODE:-ok}" == environment-variable ]]; then printf '%s\\n' '[{"variables":[{"name":"CREDENTIAL_EXPORT_OPEN","value":"true"}]}]'
    else printf '%s\\n' '[{"variables":[]}]'; fi
    ;;
  *credential-migration/secrets*)
    if [[ "\${FAKE_MODE:-ok}" == secret-api-error ]]; then echo 'secret API failed' >&2; exit 1
    elif [[ "\${FAKE_MODE:-ok}" == environment-secret ]]; then printf '%s\\n' '[{"secrets":[{"name":"SHADOW"}]}]'
    else printf '%s\\n' '[{"secrets":[]}]'; fi
    ;;
  *production/variables*)
    if [[ "\${FAKE_MODE:-ok}" == production-variable-api-error ]]; then echo 'production variable API failed' >&2; exit 1
    elif [[ "\${FAKE_MODE:-ok}" == production-variable ]]; then printf '%s\\n' '[{"variables":[{"name":"CREDENTIAL_VERIFY_OPEN","value":"true"}]}]'
    else printf '%s\\n' '[{"variables":[]}]'; fi
    ;;
  *production/secrets*)
    if [[ "\${FAKE_MODE:-ok}" == production-secret-api-error ]]; then echo 'production secret API failed' >&2; exit 1
    elif [[ "\${FAKE_MODE:-ok}" == production-secret ]]; then printf '%s\\n' '[{"secrets":[{"name":"SHADOW"}]}]'
    elif [[ "\${FAKE_MODE:-ok}" == production-complete ]]; then printf '%s\\n' '[{"secrets":[{"name":"PRODUCTION_CLOUDFLARE_API_TOKEN"},{"name":"PRODUCTION_CLOUDFLARE_ACCOUNT_ID"}]}]'
    elif [[ "\${FAKE_MODE:-ok}" == production-incomplete ]]; then printf '%s\\n' '[{"secrets":[{"name":"PRODUCTION_CLOUDFLARE_ACCOUNT_ID"}]}]'
    else printf '%s\\n' '[{"secrets":[]}]'; fi
    ;;
  *actions/secrets*)
    if [[ "\${FAKE_MODE:-ok}" == repository-secret-api-error ]]; then echo 'repository secret API failed' >&2; exit 1
    elif [[ "\${FAKE_MODE:-ok}" == repository-secret ]]; then printf '%s\\n' '[{"secrets":[{"name":"CLOUDFLARE_API_TOKEN"}]}]'
    elif [[ "\${FAKE_MODE:-ok}" == production-repository-secret ]]; then printf '%s\\n' '[{"secrets":[{"name":"PRODUCTION_CLOUDFLARE_API_TOKEN"}]}]'
    else printf '%s\\n' '[{"secrets":[{"name":"CLAUDE_CODE_OAUTH_TOKEN"}]}]'; fi
    ;;
  *) exit 91 ;;
esac
`);
    await Bun.spawn(["chmod", "+x", gh]).exited;
    const run = async (mode: string): Promise<number> => {
      const child = Bun.spawn(["bash", "scripts/check-credential-migration-environment.sh"], {
        cwd: process.cwd(),
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: "example/gitzette", FAKE_MODE: mode },
        stdout: "pipe", stderr: "pipe",
      });
      return child.exited;
    };
    expect(await run("ok")).toBe(0);
    expect(await run("reviewer")).toBe(1);
    expect(await run("self-review")).toBe(1);
    expect(await run("extra-policy")).toBe(1);
    expect(await run("extra-reviewer")).toBe(1);
    expect(await run("no-policy")).toBe(1);
    expect(await run("wait-timer")).toBe(1);
    expect(await run("protected-branch-policy")).toBe(1);
    expect(await run("admin-bypass")).toBe(1);
    expect(await run("missing")).toBe(4);
    expect(await run("auth")).toBe(3);
    const runInventory = (
      mode: string,
      requireProductionCredentials = "false",
      requireNoRepositoryCredentials = "false",
    ): Promise<number> => Bun.spawn([
      "bash", "scripts/check-credential-migration-inventory.sh",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GITHUB_REPOSITORY: "example/gitzette",
        FAKE_MODE: mode,
        REQUIRE_PRODUCTION_CREDENTIALS: requireProductionCredentials,
        REQUIRE_NO_REPOSITORY_CREDENTIALS: requireNoRepositoryCredentials,
      },
      stdout: "pipe", stderr: "pipe",
    }).exited;
    expect(await runInventory("ok")).toBe(0);
    expect(await runInventory("production-complete")).toBe(0);
    expect(await runInventory("production-incomplete")).toBe(1);
    expect(await runInventory("production-complete", "true")).toBe(0);
    expect(await runInventory("ok", "true")).toBe(1);
    expect(await runInventory("ok", "invalid")).toBe(1);
    expect(await runInventory("ok", "false", "invalid")).toBe(1);
    expect(await runInventory("ok", "false", "true")).toBe(0);
    expect(await runInventory("repository-secret", "false", "true")).toBe(1);
    expect(await runInventory("production-repository-secret", "false", "true")).toBe(1);
    expect(await runInventory("repository-secret-api-error", "false", "true")).toBe(3);
    expect(await runInventory("environment-variable")).toBe(1);
    expect(await runInventory("environment-secret")).toBe(1);
    expect(await runInventory("variable-api-error")).toBe(3);
    expect(await runInventory("secret-api-error")).toBe(3);
    expect(await runInventory("production-variable")).toBe(1);
    expect(await runInventory("production-secret")).toBe(1);
    expect(await runInventory("production-variable-api-error")).toBe(3);
    expect(await runInventory("production-secret-api-error")).toBe(3);
    const bypassFailure = Bun.spawn(["bash", "scripts/check-credential-migration-environment.sh"], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: "example/gitzette", FAKE_MODE: "admin-bypass" },
      stdout: "pipe", stderr: "pipe",
    });
    const bypassStderr = await new Response(bypassFailure.stderr).text();
    expect(await bypassFailure.exited).toBe(1);
    expect(bypassStderr).toContain('disable "Allow administrators to bypass configured protection rules"');
    expect(bypassStderr).toContain("credential-migration");
    const authFailure = Bun.spawn(["bash", "scripts/check-credential-migration-environment.sh"], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: "example/gitzette", FAKE_MODE: "auth" },
      stdout: "pipe", stderr: "pipe",
    });
    const authStderr = await new Response(authFailure.stderr).text();
    expect(await authFailure.exited).toBe(3);
    expect(authStderr).toContain("unable to read credential-migration environment");
    expect(authStderr).toContain("fake API failure");
    const missing = Bun.spawn(["bash", "scripts/check-credential-migration-environment.sh"], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: "example/gitzette", FAKE_MODE: "missing" },
      stdout: "pipe", stderr: "pipe",
    });
    const missingStderr = await new Response(missing.stderr).text();
    expect(await missing.exited).toBe(4);
    expect(missingStderr).toContain("credential-migration environment is missing; run scripts/apply-credential-migration-environment.sh");
    expect(missingStderr).toContain("absent from the readable repository inventory");

    const apply = await Bun.file("scripts/apply-credential-migration-environment.sh").text();
    expect(apply).toContain("post_apply_environment");
    expect(apply).toContain("unable to re-read credential-migration environment after apply");
    expect(apply).toContain("credential-migration was newly created");
    expect(apply).toContain(".branch_policies[] | [.name,.type] | @tsv");
    expect(apply).not.toContain("-f name=main");
    expect(apply).not.toContain("{wait_timer,can_admins_bypass");
  });

  test("applies the reviewed policy and reconciles branch-policy drift", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitzette-migration-apply-"));
    const bin = join(root, "bin");
    await mkdir(bin);
    const gh = join(bin, "gh");
    await Bun.write(gh, `#!/usr/bin/env bash
set -euo pipefail
method=GET; endpoint=""
for argument in "$@"; do
  [[ "$argument" != PUT && "$argument" != POST && "$argument" != DELETE ]] || method="$argument"
  [[ "$argument" != repos/* ]] || endpoint="$argument"
done
if [[ "$method" == PUT ]]; then cat >"$FAKE_RECORD/put.json"; : >"$FAKE_RECORD/installed"; exit 0; fi
if [[ "$method" == DELETE ]]; then printf '%s\\n' "$endpoint" >>"$FAKE_RECORD/delete.log"; : >"$FAKE_RECORD/deleted"; exit 0; fi
if [[ "$method" == POST ]]; then printf '%s\\n' "$*" >>"$FAKE_RECORD/post.log"; : >"$FAKE_RECORD/posted"; exit 0; fi
case "$endpoint" in
  repos/example/gitzette/environments/credential-migration)
    if [[ "\${FAKE_MODE:-correct}" == unreadable && ! -f "$FAKE_RECORD/installed" ]]; then
      echo 'credential migration API unavailable' >&2
      exit 1
    fi
    if [[ "\${FAKE_MODE:-correct}" == missing && ! -f "$FAKE_RECORD/installed" ]]; then
      [[ "$*" != *--include* ]] || printf 'HTTP/2.0 404 Not Found\r\n\r\n{"message":"Not Found"}\n'
      echo 'gh: Not Found (HTTP 404)' >&2
      exit 1
    fi
    bypass=false; [[ "\${FAKE_MODE:-correct}" != missing && "\${FAKE_MODE:-correct}" != bypass ]] || bypass=true
    protected=false; custom=true
    if [[ ! -f "$FAKE_RECORD/installed" && "\${FAKE_MODE:-correct}" == protected-transition ]]; then
      protected=true; custom=false
    fi
    if [[ ! -f "$FAKE_RECORD/installed" && "\${FAKE_MODE:-correct}" == null-transition ]]; then
      jq -nc --argjson bypass "$bypass" '{can_admins_bypass:$bypass,protection_rules:[{type:"required_reviewers",prevent_self_review:true,reviewers:[{type:"User",reviewer:{id:1345402,login:"NikolayS"}}]}],deployment_branch_policy:null}'
      exit 0
    fi
    jq -nc --argjson bypass "$bypass" --argjson protected "$protected" --argjson custom "$custom" '{can_admins_bypass:$bypass,protection_rules:[{type:"required_reviewers",prevent_self_review:true,reviewers:[{type:"User",reviewer:{id:1345402,login:"NikolayS"}}]}],deployment_branch_policy:{protected_branches:$protected,custom_branch_policies:$custom}}'
    ;;
  *environments?per_page=100) printf '%s\n' '[{"environments":[]}]' ;;
  *deployment-branch-policies*)
    count_file="$FAKE_RECORD/policy-count"; count=0; [[ ! -f "$count_file" ]] || count="$(<"$count_file")"; count=$((count + 1)); printf '%s' "$count" >"$count_file"
    if [[ -f "$FAKE_RECORD/posted" ]]; then
      printf '%s\\n' '[{"branch_policies":[{"id":10,"name":"main","type":"branch"}]}]'
    elif [[ -f "$FAKE_RECORD/deleted" && "\${FAKE_MODE:-correct}" == duplicate ]]; then
      printf '%s\\n' '[{"branch_policies":[{"id":10,"name":"main","type":"branch"}]}]'
    elif [[ -f "$FAKE_RECORD/deleted" ]]; then
      printf '%s\\n' '[{"branch_policies":[]}]'
    elif [[ ("\${FAKE_MODE:-correct}" == stale || "\${FAKE_MODE:-correct}" == protected-transition || "\${FAKE_MODE:-correct}" == null-transition) && "$count" -eq 1 ]]; then
      printf '%s\\n' '[{"branch_policies":[{"id":9,"name":"other","type":"branch"}]}]'
    elif [[ "\${FAKE_MODE:-correct}" == missing && "$count" -eq 1 ]]; then
      printf '%s\\n' '[{"branch_policies":[]}]'
    elif [[ "\${FAKE_MODE:-correct}" == duplicate && "$count" -eq 1 ]]; then
      printf '%s\\n' '[{"branch_policies":[{"id":10,"name":"main","type":"branch"},{"id":11,"name":"main","type":"branch"}]}]'
    else
      printf '%s\\n' '[{"branch_policies":[{"id":10,"name":"main","type":"branch"}]}]'
    fi
    ;;
  *credential-migration/variables*) printf '%s\\n' '[{"variables":[]}]' ;;
  *credential-migration/secrets*) printf '%s\\n' '[{"secrets":[]}]' ;;
  *) exit 91 ;;
esac
`);
    await Bun.spawn(["chmod", "+x", gh]).exited;
    const date = join(bin, "date");
    await Bun.write(date, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *" -d "* ]]; then printf '100\\n'; else printf '%s\\n' "\${FAKE_NOW_EPOCH:-99}"; fi
`);
    await Bun.spawn(["chmod", "+x", date]).exited;
    const run = async (mode: string, record: string, nowEpoch = "99"): Promise<number> => {
      await mkdir(record);
      const child = Bun.spawn(["bash", "scripts/apply-credential-migration-environment.sh"], {
        cwd: process.cwd(),
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: "example/gitzette", FAKE_MODE: mode, FAKE_RECORD: record, FAKE_NOW_EPOCH: nowEpoch },
        stdout: "pipe", stderr: "pipe",
      });
      return child.exited;
    };
    const expired = join(root, "expired");
    expect(await run("correct", expired, "100")).toBe(1);
    expect(await Bun.file(join(expired, "put.json")).exists()).toBe(false);
    const stale = join(root, "stale");
    expect(await run("stale", stale)).toBe(0);
    expect(JSON.parse(await Bun.file(join(stale, "put.json")).text()).can_admins_bypass).toBeUndefined();
    expect(await Bun.file(join(stale, "delete.log")).text()).toContain("deployment-branch-policies/9");
    expect(await Bun.file(join(stale, "post.log")).text()).toContain("name=main");

    for (const mode of ["protected-transition", "null-transition"]) {
      const record = join(root, mode);
      expect(await run(mode, record)).toBe(0);
      expect(await Bun.file(join(record, "delete.log")).text()).toContain("deployment-branch-policies/9");
      expect(await Bun.file(join(record, "post.log")).text()).toContain("name=main");
    }

    const correct = join(root, "correct");
    expect(await run("correct", correct)).toBe(0);
    expect(await Bun.file(join(correct, "delete.log")).exists()).toBe(false);
    expect(await Bun.file(join(correct, "post.log")).exists()).toBe(false);

    const duplicate = join(root, "duplicate");
    expect(await run("duplicate", duplicate)).toBe(0);
    expect(await Bun.file(join(duplicate, "delete.log")).text()).toContain("deployment-branch-policies/11");
    expect(await Bun.file(join(duplicate, "delete.log")).text()).not.toContain("deployment-branch-policies/10");
    expect(await Bun.file(join(duplicate, "post.log")).exists()).toBe(false);

    const bypass = join(root, "bypass");
    expect(await run("bypass", bypass)).toBe(1);
    expect(await Bun.file(join(bypass, "put.json")).exists()).toBe(false);

    const unreadable = join(root, "unreadable");
    expect(await run("unreadable", unreadable)).toBe(3);
    expect(await Bun.file(join(unreadable, "put.json")).exists()).toBe(false);

    const missing = join(root, "missing");
    await mkdir(missing);
    const firstApply = Bun.spawn(["bash", "scripts/apply-credential-migration-environment.sh"], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: "example/gitzette", FAKE_MODE: "missing", FAKE_RECORD: missing },
      stdout: "pipe", stderr: "pipe",
    });
    const firstApplyStderr = await new Response(firstApply.stderr).text();
    expect(await firstApply.exited).toBe(1);
    expect(await Bun.file(join(missing, "put.json")).exists()).toBe(true);
    expect(firstApplyStderr).toContain("credential-migration was newly created");
  });

  test("distinguishes inventory-proven absence from permission-masked 404", async () => {
    const root = await mkdtemp(join(tmpdir(), "gitzette-environment-lookup-"));
    const gh = join(root, "gh");
    await Bun.write(gh, `#!/usr/bin/env bash
set -euo pipefail
endpoint="\${*: -1}"
case "$endpoint" in
  repos/example/gitzette/environments/production)
    if [[ "\${FAKE_MODE:-ok}" == ok ]]; then printf '{"name":"production"}\n'; exit 0; fi
    if [[ "\${FAKE_MODE:-ok}" == transient && "$*" != *--include* && -f "$FAKE_STATE.transient" ]]; then
      printf '{"name":"production"}\n'; exit 0
    fi
    if [[ "$*" == *--include* ]]; then
      if [[ "\${FAKE_MODE:-ok}" == transient ]]; then
        : >"$FAKE_STATE.transient"
        printf 'HTTP/1.1 301 Redirect\r\n\r\nHTTP/2.0 200 OK\r\n\r\n{"name":"production"}\n'
        exit 0
      fi
      status=404; [[ "\${FAKE_MODE:-ok}" != server-error ]] || status=500
      printf 'HTTP/2.0 %s Error\r\n\r\n{"message":"error"}\n' "$status"
    fi
    echo 'lookup failed' >&2
    exit 1
    ;;
  *environments?per_page=100)
    if [[ "\${FAKE_MODE:-ok}" == absent ]]; then
      printf '[{"environments":[]}]\n'
    else
      printf '[{"environments":[{"name":"production"}]}]\n'
    fi
    ;;
  *) exit 91 ;;
esac
`);
    await Bun.spawn(["chmod", "+x", gh]).exited;
    const run = (mode: string): Promise<number> => Bun.spawn([
      "bash", "scripts/get-github-environment.sh", "example/gitzette", "production",
    ], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${root}:${process.env.PATH}`, FAKE_MODE: mode, FAKE_STATE: join(root, "state") },
      stdout: "pipe", stderr: "pipe",
    }).exited;
    expect(await run("ok")).toBe(0);
    expect(await run("absent")).toBe(4);
    expect(await run("masked")).toBe(3);
    expect(await run("server-error")).toBe(3);
    expect(await run("transient")).toBe(0);
  });
});
