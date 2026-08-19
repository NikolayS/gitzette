import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("one-shot credential migration boundary", () => {
  test("pins dispatcher, rerun actor, environment, encryption, and artifact lifetime", async () => {
    const workflow = await Bun.file(".github/workflows/migrate-production-credentials.yml").text();
    const policy = JSON.parse(await Bun.file("config/credential-migration-environment.json").text()) as {
      prevent_self_review: boolean;
      reviewers: Array<{ id: number }>;
      branch_policies: Array<{ name: string; type: string }>;
    };
    const parsed = Bun.YAML.parse(workflow) as { on: Record<string, unknown> };
    expect(Object.keys(parsed.on)).toEqual(["workflow_dispatch"]);
    expect(workflow).toContain('[[ "$DISPATCHER_ID" != "280144521" ]]');
    expect(workflow).toContain('[[ "$TRIGGERING_ACTOR" != "samo-agent" ]]');
    expect(workflow).toContain('[[ "$DISPATCH_REF" != "refs/heads/main" ]]');
    expect(workflow).toContain("MIGRATION_OPEN: ${{ vars.CREDENTIAL_MIGRATION_OPEN }}");
    expect(workflow).toContain("    needs: authorize-export");
    expect(workflow).toContain("    environment: credential-migration");
    expect(workflow).toContain("both Cloudflare repository secrets must be present");
    expect(workflow).toContain("7067899ede540031e13351ac29297fa51c0dc975f9ed2702d1c4dfe937299cdc");
    expect(workflow).toContain("rsa_mgf1_md:sha256");
    expect(workflow).toContain("actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02");
    expect(workflow).toContain("retention-days: 1");
    expect(workflow).not.toContain("encrypted_credentials=");
    expect(workflow).not.toContain("set -x");
    expect(workflow).not.toMatch(/CLOUDFLARE_[A-Z_]+.*(?:GITHUB_OUTPUT|GITHUB_ENV)/);
    expect(workflow).not.toContain("credentials.json");
    expect(workflow).toContain("permissions: {}");
    expect(policy.prevent_self_review).toBe(true);
    expect(policy.reviewers.map(({ id }) => id)).toEqual([1345402]);
    expect(policy.branch_policies).toEqual([{ name: "main", type: "branch" }]);
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
    reviewer_id=1345402; reviewer_login=NikolayS; prevent=true
    [[ "\${FAKE_MODE:-ok}" != reviewer ]] || { reviewer_id=280144521; reviewer_login=samo-agent; }
    [[ "\${FAKE_MODE:-ok}" != self-review ]] || prevent=false
    jq -n --argjson id "$reviewer_id" --arg login "$reviewer_login" --argjson prevent "$prevent" '{
      protection_rules:[{type:"required_reviewers",prevent_self_review:$prevent,reviewers:[{type:"User",reviewer:{id:$id,login:$login}}]}],
      deployment_branch_policy:{protected_branches:false,custom_branch_policies:true}
    }'
    ;;
  *deployment-branch-policies*)
    if [[ "\${FAKE_MODE:-ok}" == extra-policy ]]; then
      printf '%s\\n' '[{"branch_policies":[{"name":"main","type":"branch"},{"name":"other","type":"branch"}]}]'
    else
      printf '%s\\n' '[{"branch_policies":[{"name":"main","type":"branch"}]}]'
    fi
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
    expect(await run("missing")).toBe(1);

    const apply = await Bun.file("scripts/apply-credential-migration-environment.sh").text();
    expect(apply).toContain(".branch_policies[] | [.name,.type] | @tsv");
    expect(apply).not.toContain("-f name=main");
  });
});
