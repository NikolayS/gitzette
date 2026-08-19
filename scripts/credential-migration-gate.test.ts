import { describe, expect, test } from "bun:test";

describe("one-shot credential migration boundary", () => {
  test("pins dispatcher, rerun actor, environment, encryption, and artifact lifetime", async () => {
    const workflow = await Bun.file(".github/workflows/migrate-production-credentials.yml").text();
    const policy = JSON.parse(await Bun.file("config/credential-migration-environment.json").text()) as {
      prevent_self_review: boolean;
      reviewers: Array<{ id: number }>;
      branch_policies: Array<{ name: string; type: string }>;
    };
    expect(workflow).toContain('[[ "$DISPATCHER_ID" != 280144521 ]]');
    expect(workflow).toContain('[[ "$TRIGGERING_ACTOR" != samo-agent ]]');
    expect(workflow).toContain("MIGRATION_OPEN: ${{ vars.CREDENTIAL_MIGRATION_OPEN }}");
    expect(workflow).toContain("    needs: authorize-export");
    expect(workflow).toContain("    environment: credential-migration");
    expect(workflow).toContain("both Cloudflare repository secrets must be present");
    expect(workflow).toContain("7067899ede540031e13351ac29297fa51c0dc975f9ed2702d1c4dfe937299cdc");
    expect(workflow).toContain("rsa_mgf1_md:sha256");
    expect(workflow).toContain("actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02");
    expect(workflow).toContain("retention-days: 1");
    expect(workflow).not.toContain("encrypted_credentials=");
    expect(workflow).toContain("permissions: {}");
    expect(policy.prevent_self_review).toBe(true);
    expect(policy.reviewers.map(({ id }) => id)).toEqual([1345402]);
    expect(policy.branch_policies).toEqual([{ name: "main", type: "branch" }]);
  });
});
