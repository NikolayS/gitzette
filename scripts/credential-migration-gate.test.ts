import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("one-shot credential migration boundary", () => {
  test("pins dispatcher, approvals, encryption, and private transfer storage", async () => {
    const workflow = await Bun.file(".github/workflows/migrate-production-credentials.yml").text();
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
        environment?: string;
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
    expect(workflow).toContain("both production environment credentials must be present");
    expect(workflow).toContain("both Cloudflare repository secrets must be present");
    expect(workflow).toContain("7067899ede540031e13351ac29297fa51c0dc975f9ed2702d1c4dfe937299cdc");
    expect(workflow).toContain("rsa_mgf1_md:sha256");
    expect(workflow).toContain("credential_migration_transfer");
    expect(workflow).toContain("4a3624d7-7de8-46d5-91f5-7ee79856ccaa");
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
    expect(policy.branch_policies).toEqual([]);
    expect(policy.deployment_branch_policy).toEqual({ protected_branches: true, custom_branch_policies: false });
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
    const fingerprint = createHash("sha256")
      .update(publicKey.export({ type: "spki", format: "der" }))
      .digest("hex");
    expect(fingerprint).toBe("7067899ede540031e13351ac29297fa51c0dc975f9ed2702d1c4dfe937299cdc");
    const migrationDoc = await Bun.file("docs/credential-migration.md").text();
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
    expect(migrationDoc.lastIndexOf("bash scripts/check-credential-migration-environment.sh", migrationDoc.indexOf("gh variable set CREDENTIAL_EXPORT_OPEN"))).toBeGreaterThan(-1);
    expect(migrationDoc.indexOf("gh variable delete CREDENTIAL_EXPORT_OPEN")).toBeLessThan(
      migrationDoc.indexOf('operator_token_file="${OPERATOR_TOKEN_FILE'),
    );
    expect(migrationDoc).toContain("gh variable set CREDENTIAL_VERIFY_OPEN --body true");
    expect(migrationDoc.lastIndexOf("bash scripts/check-production-environment.sh", migrationDoc.indexOf("gh variable set CREDENTIAL_VERIFY_OPEN"))).toBeGreaterThan(-1);
    expect(migrationDoc).toContain("gh variable delete CREDENTIAL_VERIFY_OPEN");
    expect(migrationDoc).toContain("only clean closed state is an absent variable");
    expect(migrationDoc.indexOf("gh secret delete CLOUDFLARE_ACCOUNT_ID")).toBeLessThan(
      migrationDoc.indexOf("--ref main -f operation=verify"),
    );
    expect(migrationDoc).toContain("remaining_repository_cloudflare_secrets");
    expect(migrationDoc).toContain("GitHub can silently fall back");
    expect(migrationDoc).toContain("GitHub pins the workflow\n   run to the immutable `main` SHA at dispatch");
    expect(migrationDoc).toContain("Production is temporarily widened");
    expect(migrationDoc).toContain("#67 restores the `v*`-only policy");
    expect(migrationDoc).toContain("#67 removes the exclusion after dropping the");
    expect(migrationDoc).toContain("readability block from `.github/workflows/ci.yml`");
    for (const schemaGate of [
      "scripts/check-production-applied-schema.sh",
      "scripts/check-production-drift.sh",
      "scripts/check-production-schema.sh",
    ]) {
      expect(await Bun.file(schemaGate).text()).toContain("credential_migration_transfer");
    }
    expect(migrationDoc).toContain("On any abort or operator");
    expect(migrationDoc.indexOf("gh secret delete CLOUDFLARE_ACCOUNT_ID")).toBeLessThan(
      migrationDoc.indexOf("drop table credential_migration_transfer"),
    );
    expect(migrationDoc).toContain("switch-residue job is expected red during an open export switch");
    expect(migrationDoc).toContain("dedicated child Bash process");
    expect(migrationDoc).toContain("unset HISTFILE; set +o history");
    expect(migrationDoc).toContain("Each violation must exit nonzero");
    for (const teardownItem of [
      "credential-migration-policy-guard.yml", "credential-migration-environment.json",
      "credential-migration-gate.test.ts",
      "check-credential-migration-inventory.sh",
      "CREDENTIAL_EXPORT_OPEN", "CREDENTIAL_VERIFY_OPEN",
    ]) expect(migrationDoc).toContain(teardownItem);
    expect(migrationDoc).toContain("Retain `scripts/get-github-environment.sh`");
    expect(migrationDoc).toContain("repository Actions secrets and repository Actions variables must both be\n   empty after migration");
    expect(migrationDoc).toContain("production-policy` job is expected red");
    expect(migrationDoc).toContain("environment_credentials_ready=true");

    const policyGuard = await Bun.file(".github/workflows/credential-migration-policy-guard.yml").text();
    const parsedPolicyGuard = Bun.YAML.parse(policyGuard) as {
      on: { schedule: Array<{ cron: string }> };
      permissions: Record<string, string>;
      jobs: Record<string, { permissions: Record<string, string>; steps: Array<{ name?: string; run?: string }> }>;
    };
    expect(parsedPolicyGuard.on.schedule).toEqual([{ cron: "*/5 * * * *" }]);
    expect(policyGuard).toContain("bash scripts/check-production-environment.sh");
    expect(policyGuard).toContain("bash scripts/check-credential-migration-environment.sh");
    expect(policyGuard).toContain("CRITICAL: production no longer admits exactly protected main and release tags");
    expect(policyGuard).toContain("GUARD UNREADABLE: production environment API evidence could not be retrieved");
    expect(policyGuard).toContain("CRITICAL: production environment is missing");
    expect(policyGuard).toContain("CRITICAL: credential-migration no longer requires Nik-only approval with self-review blocked");
    expect(policyGuard).toContain('[[ "$REPOSITORY" == "NikolayS/gitzette" ]]');
    expect(policyGuard).not.toContain("github.event.repository.fork");
    expect(policyGuard).toContain("EXPORT_OPEN: ${{ vars.CREDENTIAL_EXPORT_OPEN }}");
    expect(policyGuard).toContain("VERIFY_OPEN: ${{ vars.CREDENTIAL_VERIFY_OPEN }}");
    expect(policyGuard).toContain('a credential migration switch remains defined');
    expect(policyGuard).toContain("  migration-switches:");
    expect(policyGuard).not.toContain("if: ${{ github.repository == 'NikolayS/gitzette' }}");
    expect(parsedPolicyGuard.permissions).toEqual({});
    expect(parsedPolicyGuard.jobs["production-policy"].permissions).toEqual({ actions: "read", contents: "read" });
    expect(parsedPolicyGuard.jobs["migration-switches"].permissions).toEqual({});
    const policyGuardRun = parsedPolicyGuard.jobs["production-policy"].steps.find(({ name }) =>
      name?.startsWith("Audit the fixed production ref policy"))?.run;
    const migrationGuardRun = parsedPolicyGuard.jobs["production-policy"].steps.find(({ name }) =>
      name?.startsWith("Audit the credential migration approval boundary"))?.run;
    expect(policyGuardRun).toBeDefined();
    expect(migrationGuardRun).toBeDefined();
    const policyGuardRoot = await mkdtemp(join(tmpdir(), "gitzette-policy-guard-run-"));
    const fakeBash = join(policyGuardRoot, "bash");
    await Bun.write(fakeBash, `#!/bin/sh
exit "\${FAKE_CHECKER_STATUS:-0}"
`);
    await Bun.spawn(["chmod", "+x", fakeBash]).exited;
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

    const deploy = await Bun.file(".github/workflows/deploy.yml").text();
    expect(deploy).toContain("tags:\n      - 'v*'");
    expect(deploy).not.toContain("workflow_dispatch");
    const productionConsumers: string[] = [];
    for await (const name of new Bun.Glob("*.yml").scan(".github/workflows")) {
      const path = `.github/workflows/${name}`;
      if ((await Bun.file(path).text()).includes("environment: production")) productionConsumers.push(path);
    }
    expect(productionConsumers.sort()).toEqual([
      ".github/workflows/deploy.yml",
      ".github/workflows/migrate-production-credentials.yml",
    ]);

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
else
  printf '{"success":%s,"result":[{"success":%s},{"success":%s}]}\\n' "\${FAKE_CF_SUCCESS:-true}" "\${FAKE_CF_SUCCESS:-true}" "\${FAKE_CF_SUCCESS:-true}"
fi
`);
    await Bun.spawn(["chmod", "+x", curl]).exited;
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
    expect(await execute(revalidateRun, { MIGRATION_OPEN: undefined })).toBe(1);
    expect(await execute(revalidateRun, { MIGRATION_OPEN: "True" })).toBe(1);
    expect(await execute(revalidateRun, { MIGRATION_OPEN: "true " })).toBe(1);
    expect(await execute(authorizeRun, { OPERATION: "attacker" })).toBe(1);
    expect(await execute(revalidateRun, { FAKE_ACTOR_ID: "1" })).toBe(1);
    expect(await execute(revalidateRun, { FAKE_APPROVER_ID: "1" })).toBe(1);
    expect(await execute(revalidateRun, { FAKE_APPROVAL_ENV: "other" })).toBe(1);
    expect(await execute(revalidateRun, { FAKE_APPROVAL_STATE: "rejected" })).toBe(1);
    expect(await execute(revalidateRun, { FAKE_APPROVAL_EMPTY: "true" })).toBe(1);
    const curlRecord = join(gateRoot, "curl-record");
    expect(await execute(revalidateRun, { FAKE_CURL_RECORD: curlRecord })).toBe(0);
    const curlArgs = await Bun.file(`${curlRecord}.args`).text();
    const curlStdin = await Bun.file(`${curlRecord}.stdin`).text();
    expect(curlArgs).toContain("--config\n-\n");
    expect(curlArgs).toContain("https://api.github.com/repos/example/gitzette/actions/runs/77");
    expect(curlArgs).toContain("https://api.github.com/repos/example/gitzette/actions/runs/77/approvals");
    expect(curlArgs).not.toContain("fake");
    expect(curlStdin.match(/header = "Authorization: Bearer fake"/g)?.length).toBe(2);
    expect(await execute(revalidateRun, { FAKE_CURL_FAIL: "true" })).not.toBe(0);
    const verify = { OPERATION: "verify", DISPATCH_REF: "refs/heads/main", VERIFY_OPEN: "true", FAKE_APPROVAL_ENV: "production" };
    expect(await execute(authorizeRun, verify)).toBe(0);
    expect(await execute(authorizeRun, { ...verify, GITHUB_SHA: "stale" })).toBe(1);
    expect(await execute(verifyApprovalRun, verify)).toBe(0);
    expect(await execute(verifyApprovalRun, { ...verify, FAKE_APPROVAL_ENV: "other" })).toBe(1);
    expect(await execute(verifyApprovalRun, { ...verify, FAKE_APPROVER_ID: "1" })).toBe(1);
    expect(await execute(verifyApprovalRun, { ...verify, FAKE_APPROVAL_STATE: "rejected" })).toBe(1);
    expect(await execute(verifyApprovalRun, { ...verify, FAKE_APPROVAL_EMPTY: "true" })).toBe(1);
    expect(await execute(verifyApprovalRun, { ...verify, MIGRATION_OPEN: "false" })).toBe(1);
    expect(await execute(verifyApprovalRun, { ...verify, DISPATCH_REF: "refs/heads/other" })).toBe(1);
    expect(await execute(verifyApprovalRun, { ...verify, DISPATCH_SHA: "stale" })).toBe(1);
    expect(await execute(verifyCredentialsRun, {
      CLOUDFLARE_ACCOUNT_ID: "exact-account", CLOUDFLARE_API_TOKEN: "exact-token",
    })).toBe(0);
    expect(await execute(verifyCredentialsRun, {
      CLOUDFLARE_ACCOUNT_ID: "exact-account", CLOUDFLARE_API_TOKEN: "exact-token", FAKE_CF_SUCCESS: "false",
    })).not.toBe(0);
    expect(await execute(verifyCredentialsRun, {
      CLOUDFLARE_ACCOUNT_ID: "", CLOUDFLARE_API_TOKEN: "exact-token",
    })).toBe(1);
    expect(await execute(verifyCredentialsRun, {
      CLOUDFLARE_ACCOUNT_ID: "exact-account", CLOUDFLARE_API_TOKEN: undefined,
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
      CLOUDFLARE_ACCOUNT_ID: "exact-account",
      CLOUDFLARE_API_TOKEN: "exact-token",
      CLOUDFLARE_D1_DATABASE_ID: "exact-database",
      GITHUB_RUN_ID: "77",
      PATH: `${gateBin}:${process.env.PATH}`,
    };
    expect(await Bun.spawn(["bash", "-c", executableExport], { env: exportEnv, stdout: "pipe", stderr: "pipe" }).exited).toBe(0);
    const encryptedPath = join(throwawayRoot, "gitzette-credential-migration", "credentials.bin");
    const decrypted = Bun.spawnSync({
      cmd: ["openssl", "pkeyutl", "-decrypt", "-inkey", privatePath,
        "-pkeyopt", "rsa_padding_mode:oaep", "-pkeyopt", "rsa_oaep_md:sha256", "-pkeyopt", "rsa_mgf1_md:sha256",
        "-in", encryptedPath],
      stdout: "pipe", stderr: "pipe",
    });
    expect(decrypted.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(decrypted.stdout))).toEqual({
      CLOUDFLARE_ACCOUNT_ID: "exact-account",
      CLOUDFLARE_API_TOKEN: "exact-token",
    });
    expect(exportRun).not.toContain('--arg api_token "$CLOUDFLARE_API_TOKEN"');
    expect(exportRun).not.toContain('--arg account_id "$CLOUDFLARE_ACCOUNT_ID"');
    expect(exportRun).not.toContain("--retry");
    const d1Request = JSON.parse(await Bun.file(join(throwawayRoot, "gitzette-credential-migration", "d1-request.json")).text());
    expect(Object.keys(d1Request)).toEqual(["batch"]);
    expect(d1Request.batch).toHaveLength(2);
    expect(d1Request.batch[0].sql).toContain("create table credential_migration_transfer");
    expect(d1Request.batch[0].sql).not.toContain("if not exists");
    expect(d1Request.batch[1].sql).toContain("insert into credential_migration_transfer");
    expect(d1Request.batch[1].sql).toContain("datetime('now')");
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
    expect(() => {
      for (const statement of d1Request.batch) {
        transferDb.prepare(statement.sql).run(...(statement.params ?? []));
      }
    }).toThrow();
    transferDb.close();
    expect(await Bun.spawn(["bash", "-c", executableExport], {
      env: { ...exportEnv, CLOUDFLARE_API_TOKEN: "" }, stdout: "pipe", stderr: "pipe",
    }).exited).toBe(1);
    expect(await Bun.spawn(["bash", "-c", exportRun ?? "exit 99"], {
      env: exportEnv, stdout: "pipe", stderr: "pipe",
    }).exited).toBe(1);
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
    else
      printf '%s\\n' '[{"branch_policies":[{"name":"main","type":"branch"},{"name":"v*","type":"tag"}]}]'
    fi
    ;;
  *) exit 91 ;;
esac
`);
    await Bun.spawn(["chmod", "+x", gh]).exited;
    const run = async (live: string, apiError = "none"): Promise<{ code: number; stdout: string; stderr: string }> => {
      const child = Bun.spawn(["bash", "scripts/check-production-environment.sh"], {
        cwd: process.cwd(),
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: "example/gitzette", FAKE_LIVE_POLICY: live, FAKE_API_ERROR: apiError },
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
    const run = async (adminBypass = false, create = false): Promise<number> => Bun.spawn([
      "bash", "scripts/apply-production-environment.sh",
    ], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: "example/gitzette", FAKE_STATE: state, FAKE_ADMIN_BYPASS: String(adminBypass), FAKE_CREATE: String(create) },
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
    reviewer_id=1345402; reviewer_login=NikolayS; prevent=true; admin_bypass=false; wait_timer=0; protected=true; custom=false
    [[ "\${FAKE_MODE:-ok}" != reviewer ]] || { reviewer_id=280144521; reviewer_login=samo-agent; }
    [[ "\${FAKE_MODE:-ok}" != self-review ]] || prevent=false
    [[ "\${FAKE_MODE:-ok}" != admin-bypass ]] || admin_bypass=true
    [[ "\${FAKE_MODE:-ok}" != wait-timer ]] || wait_timer=5
    [[ "\${FAKE_MODE:-ok}" != custom-branch-policy ]] || { protected=false; custom=true; }
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
      printf '%s\\n' '[{"branch_policies":[{"name":"other","type":"branch"}]}]'
    else
      printf '%s\\n' '[{"branch_policies":[]}]'
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
    expect(await run("extra-policy")).toBe(0);
    expect(await run("extra-reviewer")).toBe(1);
    expect(await run("no-policy")).toBe(0);
    expect(await run("wait-timer")).toBe(1);
    expect(await run("custom-branch-policy")).toBe(1);
    expect(await run("admin-bypass")).toBe(1);
    expect(await run("missing")).toBe(4);
    expect(await run("auth")).toBe(3);
    const runInventory = (mode: string): Promise<number> => Bun.spawn([
      "bash", "scripts/check-credential-migration-inventory.sh",
    ], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: "example/gitzette", FAKE_MODE: mode },
      stdout: "pipe", stderr: "pipe",
    }).exited;
    expect(await runInventory("ok")).toBe(0);
    expect(await runInventory("environment-variable")).toBe(1);
    expect(await runInventory("environment-secret")).toBe(1);
    expect(await runInventory("variable-api-error")).toBe(3);
    expect(await runInventory("secret-api-error")).toBe(3);
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
if [[ "$method" == DELETE ]]; then printf '%s\\n' "$endpoint" >>"$FAKE_RECORD/delete.log"; exit 0; fi
if [[ "$method" == POST ]]; then printf '%s\\n' "$*" >>"$FAKE_RECORD/post.log"; exit 0; fi
case "$endpoint" in
  repos/example/gitzette/environments/credential-migration)
    if [[ "\${FAKE_MODE:-correct}" == missing && ! -f "$FAKE_RECORD/installed" ]]; then
      [[ "$*" != *--include* ]] || printf 'HTTP/2.0 404 Not Found\r\n\r\n{"message":"Not Found"}\n'
      echo 'gh: Not Found (HTTP 404)' >&2
      exit 1
    fi
    bypass=false; [[ "\${FAKE_MODE:-correct}" != missing && "\${FAKE_MODE:-correct}" != bypass ]] || bypass=true
    protected=true; custom=false
    if [[ ! -f "$FAKE_RECORD/installed" && ( "\${FAKE_MODE:-correct}" == stale || "\${FAKE_MODE:-correct}" == duplicate ) ]]; then
      protected=false; custom=true
    fi
    jq -nc --argjson bypass "$bypass" --argjson protected "$protected" --argjson custom "$custom" '{can_admins_bypass:$bypass,protection_rules:[{type:"required_reviewers",prevent_self_review:true,reviewers:[{type:"User",reviewer:{id:1345402,login:"NikolayS"}}]}],deployment_branch_policy:{protected_branches:$protected,custom_branch_policies:$custom}}'
    ;;
  *environments?per_page=100) printf '%s\n' '[{"environments":[]}]' ;;
  *deployment-branch-policies*)
    count_file="$FAKE_RECORD/policy-count"; count=0; [[ ! -f "$count_file" ]] || count="$(<"$count_file")"; count=$((count + 1)); printf '%s' "$count" >"$count_file"
    if [[ "$count" -ge 2 ]]; then
      printf '%s\\n' '[{"branch_policies":[]}]'
    elif [[ "\${FAKE_MODE:-correct}" == duplicate && "$count" -eq 1 ]]; then
      printf '%s\\n' '[{"branch_policies":[{"id":10,"name":"main","type":"branch"},{"id":11,"name":"main","type":"branch"}]}]'
    elif [[ "\${FAKE_MODE:-correct}" == stale && "$count" -eq 1 ]]; then
      printf '%s\\n' '[{"branch_policies":[{"id":9,"name":"other","type":"branch"}]}]'
    else
      printf '%s\\n' '[{"branch_policies":[]}]'
    fi
    ;;
  *credential-migration/variables*) printf '%s\\n' '[{"variables":[]}]' ;;
  *credential-migration/secrets*) printf '%s\\n' '[{"secrets":[]}]' ;;
  *) exit 91 ;;
esac
`);
    await Bun.spawn(["chmod", "+x", gh]).exited;
    const run = async (mode: string, record: string): Promise<number> => {
      await mkdir(record);
      const child = Bun.spawn(["bash", "scripts/apply-credential-migration-environment.sh"], {
        cwd: process.cwd(),
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: "example/gitzette", FAKE_MODE: mode, FAKE_RECORD: record },
        stdout: "pipe", stderr: "pipe",
      });
      return child.exited;
    };
    const stale = join(root, "stale");
    expect(await run("stale", stale)).toBe(0);
    expect(JSON.parse(await Bun.file(join(stale, "put.json")).text()).can_admins_bypass).toBeUndefined();
    expect(await Bun.file(join(stale, "delete.log")).text()).toContain("deployment-branch-policies/9");
    expect(await Bun.file(join(stale, "post.log")).exists()).toBe(false);

    const correct = join(root, "correct");
    expect(await run("correct", correct)).toBe(0);
    expect(await Bun.file(join(correct, "delete.log")).exists()).toBe(false);
    expect(await Bun.file(join(correct, "post.log")).exists()).toBe(false);

    const duplicate = join(root, "duplicate");
    expect(await run("duplicate", duplicate)).toBe(0);
    expect(await Bun.file(join(duplicate, "delete.log")).text()).toContain("deployment-branch-policies/10");
    expect(await Bun.file(join(duplicate, "delete.log")).text()).toContain("deployment-branch-policies/11");
    expect(await Bun.file(join(duplicate, "post.log")).exists()).toBe(false);

    const bypass = join(root, "bypass");
    expect(await run("bypass", bypass)).toBe(1);
    expect(await Bun.file(join(bypass, "put.json")).exists()).toBe(false);

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
