import { describe, expect, test } from "bun:test";

describe("deploy review revalidation", () => {
  test("binds both checks to Actions and reads identity-bearing commit statuses", async () => {
    const workflow = await Bun.file(".github/workflows/deploy.yml").text();
    const reviewScript = await Bun.file("scripts/check-release-review.sh").text();
    const reviewEvaluator = await Bun.file("scripts/check-release-review.ts").text();
    expect(workflow).toContain("run: bash scripts/check-release-review.sh");
    expect(workflow).not.toContain("check_runs=");
    expect(reviewScript).toContain('commits/$reviewed_sha/statuses?per_page=100');
    expect(reviewEvaluator).toContain('check.name === name && check.conclusion === "success" && app.id === actionsAppId');
    expect(reviewEvaluator).toContain("samorevCreator.id !== reviewerId");
    expect(reviewEvaluator).toContain("gateCreator.id !== actionsBotId");
    const gates = [
      ["Verify required Worker secrets", "bash scripts/check-production-secrets.sh"],
      ["Verify weekly profile activation prerequisites", "bash scripts/check-weekly-profiles.sh"],
      ["Verify production drift and apply migrations", "bun run db:migrate"],
      ["Re-assert the live schema before deploying the Worker", "bash scripts/check-production-schema.sh"],
    ];
    const deployStart = workflow.indexOf("run: ./node_modules/.bin/wrangler deploy");
    expect(deployStart).toBeGreaterThanOrEqual(0);
    let previousGateStart = -1;
    for (const [name, command] of gates) {
      const stepStart = workflow.indexOf(`      - name: ${name}`);
      expect(stepStart).toBeGreaterThanOrEqual(0);
      expect(stepStart).toBeGreaterThan(previousGateStart);
      expect(stepStart).toBeLessThan(deployStart);
      previousGateStart = stepStart;
      const stepEnd = workflow.indexOf("\n      - ", stepStart + 1);
      const step = workflow.slice(stepStart, stepEnd < 0 ? undefined : stepEnd);
      expect(step.split("\n").map(line => line.trim()).filter(line => line.startsWith("run:")))
        .toEqual([`run: ${command}`]);
      expect(step).not.toContain("working-directory:");
    }
    const reviewGate = workflow.slice(workflow.indexOf("  review-gate:"), workflow.indexOf("\n  deploy:"));
    const deploy = workflow.slice(workflow.indexOf("\n  deploy:"));
    expect(reviewGate).toContain("checks: read");
    expect(reviewGate).toContain("RELEASE_SENDER_ID: ${{ github.event.sender.id }}");
    expect(reviewGate).not.toContain("if: github.event.sender.id");
    expect(reviewScript).toContain('[[ "$RELEASE_SENDER_ID" != 280144521 ]]');
    expect(reviewGate).toContain("pull-requests: read");
    expect(reviewGate).toContain("statuses: read");
    expect(reviewGate).not.toContain("/reviews");
    expect(reviewGate).not.toContain("APPROVED");
    expect(deploy).toContain("needs: review-gate");
    expect(workflow).not.toContain("always()");
    expect(deploy).toContain("contents: read");
    expect(deploy).not.toContain("checks: read");
    expect(deploy).not.toContain("pull-requests: read");
    expect(deploy).not.toContain("statuses: read");
    expect(deploy).toContain("bun install --frozen-lockfile --ignore-scripts");
  });

  test("keeps credential migration behind the production identity boundary", async () => {
    const migrationPath = ".github/workflows/migrate-production-credentials.yml";
    const workflow = await Bun.file(migrationPath).text();
    const policy = JSON.parse(await Bun.file("config/production-environment.json").text()) as {
      branch_policies: Array<{ name: string; type: string }>;
    };
    expect(policy.branch_policies.some(({ name, type }) => name === "main" && type === "branch"))
      .toBe(await Bun.file(migrationPath).exists());
    expect(workflow).toContain("  workflow_dispatch:");
    expect(workflow).not.toContain("pull_request:");
    expect(workflow).not.toContain("pull_request_target:");
    expect(workflow).not.toContain("push:");
    expect(workflow).toContain("if: github.event.sender.id == 280144521");
    expect(workflow).not.toContain("inputs:");
    expect(workflow).not.toContain("${{ inputs.");
    expect(workflow).toContain("    environment: production");
    expect(workflow).toContain("  contents: read");
    expect(workflow).not.toContain("actions/checkout");
    expect(workflow).toContain("rsa_padding_mode:oaep");
    expect(workflow).toContain("rsa_oaep_md:sha256");
    expect(workflow).toContain("7067899ede540031e13351ac29297fa51c0dc975f9ed2702d1c4dfe937299cdc");
    expect(workflow).toContain("encrypted_credentials=%s");
    expect(workflow).not.toMatch(/PRIVATE KEY|private_key|upload-artifact/);
    const environmentCheck = await Bun.file("scripts/check-production-environment.sh").text();
    expect(environmentCheck).toContain("credential migration is complete; remove its workflow");
    expect(environmentCheck).toContain("contents/.github/workflows/migrate-production-credentials.yml?ref=main");
  });
});
