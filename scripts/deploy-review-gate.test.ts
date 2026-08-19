import { describe, expect, test } from "bun:test";

describe("deploy review revalidation", () => {
  test("binds both checks to Actions and reads identity-bearing commit statuses", async () => {
    const workflow = await Bun.file(".github/workflows/deploy.yml").text();
    expect(workflow).toContain('.name == "typecheck" and .conclusion == "success" and .app.id == 15368');
    expect(workflow).toContain('.name == "base-controlled samorev publisher" and .conclusion == "success" and .app.id == 15368');
    expect(workflow).toContain('commits/$reviewed_sha/statuses?per_page=100');
    expect(workflow).not.toContain('commits/$reviewed_sha/status\")');
    expect(workflow).toContain('.context == "samorev" and .state == "success" and .creator.login == "samo-agent"');
    expect(workflow).toContain('.context == "samorev-gate" and .state == "success"');
    const secretStepStart = workflow.indexOf("      - name: Verify required Worker secrets");
    expect(secretStepStart).toBeGreaterThanOrEqual(0);
    const secretStepEnd = workflow.indexOf("\n      - ", secretStepStart + 1);
    const secretStep = workflow.slice(secretStepStart, secretStepEnd < 0 ? undefined : secretStepEnd);
    expect(secretStep).toContain("run: bash scripts/check-production-secrets.sh");
    expect(secretStep).not.toContain("working-directory:");
    const reviewGate = workflow.slice(workflow.indexOf("  review-gate:"), workflow.indexOf("\n  deploy:"));
    const deploy = workflow.slice(workflow.indexOf("\n  deploy:"));
    expect(reviewGate).toContain("checks: read");
    expect(reviewGate).toContain("pull-requests: read");
    expect(reviewGate).toContain("statuses: read");
    expect(deploy).toContain("needs: review-gate");
    expect(deploy).toContain("contents: read");
    expect(deploy).not.toContain("checks: read");
    expect(deploy).not.toContain("pull-requests: read");
    expect(deploy).not.toContain("statuses: read");
  });
});
