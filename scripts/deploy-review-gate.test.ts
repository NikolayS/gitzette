import { describe, expect, test } from "bun:test";

describe("deploy review revalidation", () => {
  test("binds both checks to Actions and reads identity-bearing commit statuses", async () => {
    const workflow = await Bun.file(".github/workflows/deploy.yml").text();
    expect(workflow).toContain('.name == "typecheck" and .conclusion == "success" and .app.id == 15368');
    expect(workflow).toContain('.name == "base-controlled samorev publisher" and .conclusion == "success" and .app.id == 15368');
    expect(workflow).toContain('commits/$reviewed_sha/statuses?per_page=100');
    expect(workflow).not.toContain('commits/$reviewed_sha/status\")');
    expect(workflow).toContain('map(select(.context == "samorev")) | sort_by(.created_at, .id) | last');
    expect(workflow).toContain('map(select(.context == "samorev-gate")) | sort_by(.created_at, .id) | last');
    expect(workflow).toContain('$samorev.state == "success" and $samorev.creator.id == 280144521');
    expect(workflow).toContain('$gate.state == "success"');
    expect(workflow).not.toContain('creator.login == "samo-agent"');
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
    expect(reviewGate).toContain("pull-requests: read");
    expect(reviewGate).toContain("statuses: read");
    expect(reviewGate).not.toContain("/reviews");
    expect(reviewGate).not.toContain("APPROVED");
    expect(deploy).toContain("needs: review-gate");
    expect(deploy).toContain("contents: read");
    expect(deploy).not.toContain("checks: read");
    expect(deploy).not.toContain("pull-requests: read");
    expect(deploy).not.toContain("statuses: read");
  });
});
