import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  isManagedProfileSuppressed,
  isProfileSuppressedByPolicy,
} from "./highlighted";
import { pageRoutes } from "./pages";
import { queueRoutes } from "./queue";

describe("managed profile publication policy", () => {
  test("suppresses a managed profile removed from the active weekly allowlist", () => {
    const managed = new Set(["dhh"]);
    expect(isProfileSuppressedByPolicy("DHH", managed, new Set())).toBe(true);
    expect(isProfileSuppressedByPolicy("DHH", managed, new Set(["dhh"]))).toBe(false);
    expect(isProfileSuppressedByPolicy("ordinary-user", managed, new Set())).toBe(false);
    expect(isManagedProfileSuppressed("DHH")).toBe(false);
    expect(isManagedProfileSuppressed("gitzette-opt-out-test")).toBe(true);
    expect(isManagedProfileSuppressed("ordinary-user")).toBe(false);
  });

  test("hides removed profile routes and blocks enqueue", async () => {
    const pages = new Hono().route("/", pageRoutes as never);
    const pageEnv = {
      DB: {
        prepare: () => ({
          all: async () => ({
            results: [
              { username: "gitzette-opt-out-test", week_key: "2026-W32", generated_at: 1 },
              { username: "DHH", week_key: "2026-W32", generated_at: 1 },
            ],
          }),
        }),
      },
    } as never;
    const home = await pages.request("/", {}, pageEnv);
    expect(home.status).toBe(200);
    expect(await home.text()).not.toContain("gitzette-opt-out-test");
    expect((await pages.request("/gitzette-opt-out-test", {}, pageEnv)).status).toBe(404);
    expect((await pages.request("/gitzette-opt-out-test/2026-W32", {}, pageEnv)).status).toBe(404);

    const suppressedImage = await pages.request("/img/1-deadbeef.webp", {}, {
      DISPATCHES: {
        get: async () => ({
          customMetadata: { ownerUserId: "retired", ownerUsername: "gitzette-opt-out-test" },
          arrayBuffer: async () => new ArrayBuffer(1),
        }),
      },
    } as never);
    expect(suppressedImage.status).toBe(404);

    const queue = new Hono().route("/", queueRoutes as never);
    const queueEnv = {
      DB: {
        prepare: () => ({
          bind() { return this; },
          first: async () => ({ id: "retired", username: "gitzette-opt-out-test", avatar_url: "" }),
        }),
      },
    } as never;
    const response = await queue.request("/generate", {
      method: "POST",
      headers: { cookie: "session=retired-session", "content-type": "application/json" },
      body: "{}",
    }, queueEnv);
    expect(response.status).toBe(410);
    expect(await response.json() as { error: string }).toEqual({ error: "profile unavailable" });
  });
});
