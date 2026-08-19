import { describe, expect, test } from "bun:test";
import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("one-shot credential migration boundary", () => {
  test("pins dispatcher, rerun actor, environment, encryption, and artifact lifetime", async () => {
    const workflow = await Bun.file(".github/workflows/migrate-production-credentials.yml").text();
    const policy = JSON.parse(await Bun.file("config/credential-migration-environment.json").text()) as {
      can_admins_bypass: boolean;
      prevent_self_review: boolean;
      reviewers: Array<{ id: number }>;
      branch_policies: Array<{ name: string; type: string }>;
    };
    const parsed = Bun.YAML.parse(workflow) as {
      on: Record<string, unknown>;
      jobs: Record<string, { steps: Array<{ name?: string; run?: string }> }>;
    };
    expect(Object.keys(parsed.on)).toEqual(["workflow_dispatch"]);
    expect(workflow).toContain('[[ "$DISPATCHER_ID" != "280144521" ]]');
    expect(workflow).toContain('[[ "$TRIGGERING_ACTOR" != "samo-agent" ]]');
    expect(workflow).toContain('[[ "$DISPATCH_REF" != "refs/heads/main" ]]');
    expect(workflow).toContain('[[ "$RUN_ATTEMPT" != "1" ]]');
    expect(workflow.match(/MIGRATION_OPEN: \$\{\{ vars\.CREDENTIAL_MIGRATION_OPEN \}\}/g)?.length).toBe(2);
    expect(workflow).toContain('triggering_actor_id="$(curl');
    expect(workflow).toContain('[[ "$triggering_actor_id" != "280144521" ]]');
    expect(workflow).toContain("MIGRATION_OPEN: ${{ vars.CREDENTIAL_MIGRATION_OPEN }}");
    expect(workflow).toContain("    needs: authorize-export");
    expect(workflow).toContain("    environment: credential-migration");
    expect(workflow).toContain("  verify-production-credentials:");
    expect(workflow).toContain("    if: ${{ inputs.operation == 'verify' }}");
    expect(workflow).toContain("    environment: production");
    expect(workflow).toContain("both production environment credentials must be present");
    expect(workflow).toContain("both Cloudflare repository secrets must be present");
    expect(workflow).toContain("7067899ede540031e13351ac29297fa51c0dc975f9ed2702d1c4dfe937299cdc");
    expect(workflow).toContain("rsa_mgf1_md:sha256");
    expect(workflow).toContain("actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02");
    expect(workflow).toContain("name: encrypted-credentials-${{ github.run_id }}-${{ github.run_attempt }}");
    expect(workflow).toContain("retention-days: 1");
    expect(workflow).not.toContain("encrypted_credentials=");
    expect(workflow).not.toContain("set -x");
    expect(workflow).not.toContain("GITHUB_OUTPUT");
    expect(workflow).not.toContain("GITHUB_ENV");
    expect(workflow).not.toContain("credentials.json");
    expect(workflow).toContain("permissions: {}");
    expect(policy.can_admins_bypass).toBe(false);
    expect(policy.prevent_self_review).toBe(true);
    expect(policy.reviewers.map(({ id }) => id)).toEqual([1345402]);
    expect(policy.branch_policies).toEqual([{ name: "main", type: "branch" }]);

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

    const authorizeRun = parsed.jobs["authorize-export"].steps.find(({ name }) => name?.startsWith("Require"))?.run;
    const revalidateRun = parsed.jobs["export-encrypted-credentials"].steps.find(({ name }) => name?.startsWith("Revalidate"))?.run;
    const exportRun = parsed.jobs["export-encrypted-credentials"].steps.find(({ name }) => name?.startsWith("Export only"))?.run;
    expect(authorizeRun).toBeDefined();
    expect(revalidateRun).toBeDefined();
    expect(exportRun).toBeDefined();
    const gateRoot = await mkdtemp(join(tmpdir(), "gitzette-migration-gate-"));
    const gateBin = join(gateRoot, "bin");
    await mkdir(gateBin);
    const curl = join(gateBin, "curl");
    await Bun.write(curl, `#!/usr/bin/env bash
set -euo pipefail
if [[ -n "\${FAKE_CURL_RECORD:-}" ]]; then printf '%s\\n' "$@" >"$FAKE_CURL_RECORD.args"; cat >"$FAKE_CURL_RECORD.stdin"; else cat >/dev/null; fi
[[ "\${FAKE_CURL_FAIL:-false}" != true ]] || exit 22
printf '{"id":%s}\\n' "\${FAKE_ACTOR_ID:-280144521}"
`);
    await Bun.spawn(["chmod", "+x", curl]).exited;
    const execute = async (run: string | undefined, overrides: Record<string, string | undefined> = {}): Promise<number> => {
      const env: Record<string, string> = {
        ...process.env,
        PATH: `${gateBin}:${process.env.PATH}`,
        DISPATCHER_ID: "280144521",
        TRIGGERING_ACTOR: "samo-agent",
        DISPATCH_REF: "refs/heads/main",
        RUN_ATTEMPT: "1",
        OPERATION: "export",
        MIGRATION_OPEN: "true",
        GH_TOKEN: "fake",
      };
      for (const [name, value] of Object.entries(overrides)) {
        if (value === undefined) delete env[name]; else env[name] = value;
      }
      return Bun.spawn(["bash", "-c", run ?? "exit 99"], { env, stdout: "pipe", stderr: "pipe" }).exited;
    };
    for (const run of [authorizeRun, revalidateRun]) {
      expect(await execute(run)).toBe(0);
      expect(await execute(run, { DISPATCHER_ID: "1" })).toBe(1);
      expect(await execute(run, { TRIGGERING_ACTOR: "attacker" })).toBe(1);
      expect(await execute(run, { DISPATCH_REF: "refs/heads/other" })).toBe(1);
      expect(await execute(run, { RUN_ATTEMPT: "2" })).toBe(1);
      expect(await execute(run, { MIGRATION_OPEN: undefined })).toBe(1);
      expect(await execute(run, { MIGRATION_OPEN: "True" })).toBe(1);
      expect(await execute(run, { MIGRATION_OPEN: "true " })).toBe(1);
    }
    expect(await execute(authorizeRun, { OPERATION: "attacker" })).toBe(1);
    expect(await execute(revalidateRun, { FAKE_ACTOR_ID: "1" })).toBe(1);
    const curlRecord = join(gateRoot, "curl-record");
    expect(await execute(revalidateRun, { FAKE_CURL_RECORD: curlRecord })).toBe(0);
    const curlArgs = await Bun.file(`${curlRecord}.args`).text();
    const curlStdin = await Bun.file(`${curlRecord}.stdin`).text();
    expect(curlArgs).toContain("--config\n-\n");
    expect(curlArgs).toContain("https://api.github.com/users/samo-agent");
    expect(curlArgs).not.toContain("fake");
    expect(curlStdin).toBe('header = "Authorization: Bearer fake"\n');
    expect(await execute(revalidateRun, { FAKE_CURL_FAIL: "true" })).not.toBe(0);

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
    expect(await Bun.spawn(["bash", "-c", executableExport], {
      env: { ...exportEnv, CLOUDFLARE_API_TOKEN: "" }, stdout: "pipe", stderr: "pipe",
    }).exited).toBe(1);
    expect(await Bun.spawn(["bash", "-c", exportRun ?? "exit 99"], {
      env: exportEnv, stdout: "pipe", stderr: "pipe",
    }).exited).toBe(1);
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
    [[ "\${FAKE_MODE:-ok}" != missing ]] || exit 1
    reviewer_id=1345402; reviewer_login=NikolayS; prevent=true; admin_bypass=false; wait_timer=0; protected=false
    [[ "\${FAKE_MODE:-ok}" != reviewer ]] || { reviewer_id=280144521; reviewer_login=samo-agent; }
    [[ "\${FAKE_MODE:-ok}" != self-review ]] || prevent=false
    [[ "\${FAKE_MODE:-ok}" != admin-bypass ]] || admin_bypass=true
    [[ "\${FAKE_MODE:-ok}" != wait-timer ]] || wait_timer=5
    [[ "\${FAKE_MODE:-ok}" != protected-branches ]] || protected=true
    extra='[]'
    [[ "\${FAKE_MODE:-ok}" != extra-reviewer ]] || extra='[{"type":"User","reviewer":{"id":280144521,"login":"samo-agent"}}]'
    jq -n --argjson id "$reviewer_id" --arg login "$reviewer_login" --argjson prevent "$prevent" \
      --argjson bypass "$admin_bypass" --argjson wait "$wait_timer" --argjson protected "$protected" --argjson extra "$extra" '{
      can_admins_bypass:$bypass,
      protection_rules:([{type:"required_reviewers",prevent_self_review:$prevent,reviewers:([{type:"User",reviewer:{id:$id,login:$login}}] + $extra)}] + (if $wait == 0 then [] else [{type:"wait_timer",wait_timer:$wait}] end)),
      deployment_branch_policy:{protected_branches:$protected,custom_branch_policies:true}
    }'
    ;;
  *deployment-branch-policies*)
    if [[ "\${FAKE_MODE:-ok}" == no-policy ]]; then
      printf '%s\\n' '[{"branch_policies":[]}]'
    elif [[ "\${FAKE_MODE:-ok}" == extra-policy ]]; then
      printf '%s\\n' '[{"branch_policies":[{"name":"main","type":"branch"},{"name":"other","type":"branch"}]}]'
    else
      printf '%s\\n' '[{"branch_policies":[{"name":"main","type":"branch"}]}]'
    fi
    ;;
  *credential-migration/variables*)
    if [[ "\${FAKE_MODE:-ok}" == environment-variable ]]; then printf '%s\\n' '[{"variables":[{"name":"CREDENTIAL_MIGRATION_OPEN","value":"true"}]}]'; else printf '%s\\n' '[{"variables":[]}]'; fi
    ;;
  *credential-migration/secrets*)
    if [[ "\${FAKE_MODE:-ok}" == environment-secret ]]; then printf '%s\\n' '[{"secrets":[{"name":"SHADOW"}]}]'; else printf '%s\\n' '[{"secrets":[]}]'; fi
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
    expect(await run("protected-branches")).toBe(1);
    expect(await run("admin-bypass")).toBe(1);
    expect(await run("environment-variable")).toBe(1);
    expect(await run("environment-secret")).toBe(1);
    expect(await run("missing")).toBe(1);

    const apply = await Bun.file("scripts/apply-credential-migration-environment.sh").text();
    expect(apply).toContain(".branch_policies[] | [.name,.type] | @tsv");
    expect(apply).not.toContain("-f name=main");
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
if [[ "$method" == PUT ]]; then cat >"$FAKE_RECORD/put.json"; exit 0; fi
if [[ "$method" == DELETE ]]; then printf '%s\\n' "$endpoint" >>"$FAKE_RECORD/delete.log"; exit 0; fi
if [[ "$method" == POST ]]; then printf '%s\\n' "$*" >>"$FAKE_RECORD/post.log"; exit 0; fi
case "$endpoint" in
  repos/example/gitzette/environments/credential-migration)
    printf '%s\\n' '{"can_admins_bypass":false,"protection_rules":[{"type":"required_reviewers","prevent_self_review":true,"reviewers":[{"type":"User","reviewer":{"id":1345402,"login":"NikolayS"}}]}],"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}'
    ;;
  *deployment-branch-policies*)
    count_file="$FAKE_RECORD/policy-count"; count=0; [[ ! -f "$count_file" ]] || count="$(<"$count_file")"; count=$((count + 1)); printf '%s' "$count" >"$count_file"
    if [[ "\${FAKE_MODE:-correct}" == stale && "$count" -eq 2 ]]; then
      printf '%s\\n' '[{"branch_policies":[]}]'
    elif [[ "\${FAKE_MODE:-correct}" == duplicate && "$count" -eq 1 ]]; then
      printf '%s\\n' '[{"branch_policies":[{"id":10,"name":"main","type":"branch"},{"id":11,"name":"main","type":"branch"}]}]'
    elif [[ "\${FAKE_MODE:-correct}" == stale && "$count" -eq 1 ]]; then
      printf '%s\\n' '[{"branch_policies":[{"id":9,"name":"other","type":"branch"}]}]'
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
    expect(JSON.parse(await Bun.file(join(stale, "put.json")).text()).can_admins_bypass).toBe(false);
    expect(await Bun.file(join(stale, "delete.log")).text()).toContain("deployment-branch-policies/9");
    expect(await Bun.file(join(stale, "post.log")).text()).toContain("name=main");
    expect(await Bun.file(join(stale, "post.log")).text()).toContain("type=branch");

    const correct = join(root, "correct");
    expect(await run("correct", correct)).toBe(0);
    expect(await Bun.file(join(correct, "delete.log")).exists()).toBe(false);
    expect(await Bun.file(join(correct, "post.log")).exists()).toBe(false);

    const duplicate = join(root, "duplicate");
    expect(await run("duplicate", duplicate)).toBe(0);
    expect(await Bun.file(join(duplicate, "delete.log")).text()).toContain("deployment-branch-policies/11");
    expect(await Bun.file(join(duplicate, "post.log")).exists()).toBe(false);
  });
});
