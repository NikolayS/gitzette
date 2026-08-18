import { describe, expect, test } from "bun:test";

describe("production migration credential guards", () => {
  test("fails explicitly before Wrangler when the applied-schema token is absent", async () => {
    const env = { ...process.env };
    delete env.CLOUDFLARE_API_TOKEN;
    delete env.CLOUDFLARE_ACCOUNT_ID;
    delete env.CLOUDFLARE_D1_TOKEN;
    const child = Bun.spawn(["bash", "scripts/check-production-applied-schema.sh"], {
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("CLOUDFLARE_API_TOKEN is required for the read-only applied-schema gate");
    expect(stderr).not.toContain("wrangler");
  });
});
