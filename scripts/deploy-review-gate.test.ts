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
  });
});
