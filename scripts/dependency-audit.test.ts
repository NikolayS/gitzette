import { describe, expect, test } from "bun:test";

describe("scheduled dependency-audit reporting", () => {
  test("keeps auditing read-only and grants issue writes only to the failure notifier", async () => {
    const workflow = await Bun.file(".github/workflows/dependency-audit.yml").text();
    const notifyStart = workflow.indexOf("\n  notify:");
    expect(notifyStart).toBeGreaterThan(0);
    const audit = workflow.slice(0, notifyStart);
    const notify = workflow.slice(notifyStart);

    expect(audit).not.toContain("issues: write");
    expect(notify).toContain("if: ${{ always() && needs.audit.result == 'failure' }}");
    expect(notify).toMatch(/permissions:[\s\S]*?contents: read[\s\S]*?issues: write[\s\S]*?steps:/);
    expect(notify).toContain('gh issue comment "$existing" --body "$body"');
    expect(notify).toContain('gh issue create --title "$title" --body "$body"');
  });
});
