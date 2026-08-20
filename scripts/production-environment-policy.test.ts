import { describe, expect, test } from "bun:test";

describe("permanent production environment policy", () => {
  test("keeps the shared environment lookup and fail-closed policy pair", async () => {
    const lookup = await Bun.file("scripts/get-github-environment.sh").text();
    const check = await Bun.file("scripts/check-production-environment.sh").text();
    const apply = await Bun.file("scripts/apply-production-environment.sh").text();

    expect(lookup).toContain("unable to distinguish a missing environment from a permission-masked 404");
    expect(check).toContain('"$root/scripts/get-github-environment.sh" "$repository" production');
    expect(check).toContain("deployment-branch-policies?per_page=100");
    expect(apply).toContain('"$root/scripts/check-production-environment.sh"');
    expect(apply).toContain("--restore-baseline");
  });

  test("keeps CI readability and bounded apt-source verification", async () => {
    const ci = await Bun.file(".github/workflows/ci.yml").text();
    const imageRuntime = await Bun.file("scripts/install-image-validation-runtime.sh").text();

    expect(ci).toContain("policy-api-readability:");
    expect(ci).toContain('"repos/$GITHUB_REPOSITORY/environments/production"');
    expect(ci).toContain('"repos/$GITHUB_REPOSITORY/environments?per_page=100"');
    expect(imageRuntime).toContain("sudo cp -- \"$apt_source\" \"$apt_source_copy\"");
    expect(imageRuntime).not.toContain("grep -REq");
  });

  test("is mechanically included in the full runner suite", async () => {
    const packageJson = await Bun.file("package.json").json() as { scripts: Record<string, string> };
    expect(packageJson.scripts["test:runner"]).toContain("scripts/*.test.ts");
    expect(packageJson.scripts["test:all"]).toContain("bun run test:runner");
  });
});
