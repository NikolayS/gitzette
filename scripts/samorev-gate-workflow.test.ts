import { describe, expect, test } from "bun:test";

describe("base-controlled samorev publisher wiring", () => {
  test("pins protected-main code and checks permissions before polling", async () => {
    const workflow = await Bun.file(".github/workflows/samorev-gate.yml").text();
    expect(workflow).toContain("on:\n  pull_request_target:");
    expect(workflow).not.toContain("\n  pull_request:\n");
    expect(workflow).toContain("ref: main");
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain('bun scripts/check-pr-workflow-permissions.ts "$BASE_SHA" "$HEAD_SHA"');
    const permissionCheck = workflow.indexOf("bun scripts/check-pr-workflow-permissions.ts");
    const verdictPoll = workflow.indexOf("bash scripts/poll-samorev-gate.sh");
    expect(permissionCheck).toBeGreaterThanOrEqual(0);
    expect(verdictPoll).toBeGreaterThan(permissionCheck);
  });
});
