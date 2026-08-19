import { describe, expect, test } from "bun:test";

describe("base-controlled samorev publisher wiring", () => {
  test("pins protected-main code and checks permissions before polling", async () => {
    const workflow = await Bun.file(".github/workflows/samorev-gate.yml").text();
    const parsed = Bun.YAML.parse(workflow) as { on?: Record<string, unknown> };
    expect(Object.keys(parsed.on ?? {}).sort()).toEqual(["pull_request_target"]);
    const trigger = parsed.on?.pull_request_target as { branches?: string[]; types?: string[] };
    expect(trigger.branches).toEqual(["main"]);
    expect(new Set(trigger.types)).toEqual(new Set([
      "opened", "synchronize", "ready_for_review", "converted_to_draft", "reopened", "edited",
    ]));
    expect(workflow).toContain("ref: main");
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain('git fetch --no-tags origin "+refs/pull/$PR_NUMBER/head:refs/gitzette/pr-head"');
    expect(workflow).toContain('test "$(git rev-parse refs/gitzette/pr-head)" = "$HEAD_SHA"');
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain('bun scripts/check-pr-workflow-permissions.ts "$BASE_SHA" "$HEAD_SHA"');
    const permissionCheck = workflow.indexOf("bun scripts/check-pr-workflow-permissions.ts");
    const verdictPoll = workflow.indexOf("bash scripts/poll-samorev-gate.sh");
    expect(permissionCheck).toBeGreaterThanOrEqual(0);
    expect(verdictPoll).toBeGreaterThan(permissionCheck);
  });
});
