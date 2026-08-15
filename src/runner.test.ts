import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { isArtifactTooLarge, isForwardStage, runnerRoutes } from "./runner";

describe("runner route boundary", () => {
  test("rejects missing and incorrect bearer credentials before database access", async () => {
    const app = new Hono().route("/runner", runnerRoutes as never);
    const env = { RUNNER_SECRET: "expected" } as never;
    expect((await app.request("/runner/jobs/claim", { method: "POST" }, env)).status).toBe(401);
    expect((await app.request("/runner/jobs/claim", { method: "POST", headers: { authorization: "Bearer wrong" } }, env)).status).toBe(401);
    expect((await app.request("/runner/jobs/claim", { method: "POST", headers: { authorization: "Bearer anything" } }, {} as never)).status).toBe(401);
    expect((await app.request("/runner/jobs/claim", { method: "POST", headers: { authorization: "Bearer anything" } }, { RUNNER_SECRET: "" } as never)).status).toBe(401);
  });

  test("allows only the explicit forward stage graph", () => {
    expect(isForwardStage("collecting", "writing")).toBe(true);
    expect(isForwardStage("writing", "illustrating")).toBe(true);
    expect(isForwardStage("illustrating", "validating")).toBe(true);
    for (const transition of [["writing", "collecting"], ["collecting", "validating"], ["validating", "validating"], ["validating", "published"]]) {
      expect(isForwardStage(transition[0], transition[1])).toBe(false);
    }
  });

  test("enforces the artifact byte boundary exactly", () => {
    expect(isArtifactTooLarge(5 * 1024 * 1024)).toBe(false);
    expect(isArtifactTooLarge(5 * 1024 * 1024 + 1)).toBe(true);
  });
});
