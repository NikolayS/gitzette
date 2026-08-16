import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { pageRoutes } from "./pages";

function statusEnv(statusToken: string | undefined) {
  return {
    STATUS_TOKEN: statusToken,
    DB: {
      prepare: () => ({
        first: async () => ({ total: 0, failed: 0, oldest_queued: null }),
      }),
    },
  } as never;
}

describe("private status route boundary", () => {
  test("rejects missing, malformed, incorrect, and unconfigured bearer credentials", async () => {
    const app = new Hono().route("/", pageRoutes as never);
    const configured = statusEnv("expected");

    expect((await app.request("/status", {}, configured)).status).toBe(403);
    expect((await app.request("/status", { headers: { authorization: "Basic expected" } }, configured)).status).toBe(403);
    expect((await app.request("/status", { headers: { authorization: "Bearer wrong" } }, configured)).status).toBe(403);
    expect((await app.request("/status", { headers: { authorization: "Bearer anything" } }, statusEnv(undefined))).status).toBe(403);
    expect((await app.request("/status", { headers: { authorization: "Bearer anything" } }, statusEnv(""))).status).toBe(403);
  });

  test("accepts only the configured bearer credential", async () => {
    const app = new Hono().route("/", pageRoutes as never);
    const response = await app.request(
      "/status",
      { headers: { authorization: "Bearer expected" } },
      statusEnv("expected"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });
});
