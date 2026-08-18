import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { buildDispatchOGTags, pageRoutes } from "./pages";

function statusEnv(statusToken: string | undefined) {
  return {
    STATUS_TOKEN: statusToken,
    DB: {
      prepare: () => ({
        first: async () => ({ total: 0, failed: 0, oldest_queued: null }),
        bind() { return this; },
        all: async () => ({ results: [{ username: "torvalds", week_key: "2026-W32", updated_at: 1 }] }),
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
    const body = await response.text();
    expect(body).toContain("Input tokens · last 7 days");
    expect(body).toContain("Operator alert · deferred weekly slots aged out · last 14 days");
    expect(body).toContain("@torvalds · 2026-W32");
  });
});

describe("dispatch social metadata", () => {
  test("decodes rendered text before escaping it exactly once", () => {
    const tags = buildDispatchOGTags(
      '<h1>Parser &amp; Queue</h1><p class="deck">Bounds &quot;hold&quot; &amp; retries stop.</p>',
      "octocat",
      "2026-W32",
    );
    expect(tags).toContain('content="Parser &amp; Queue"');
    expect(tags).toContain('content="Bounds &quot;hold&quot; &amp; retries stop."');
    expect(tags).not.toContain("&amp;amp;");
    expect(tags).not.toContain("&amp;quot;");
  });
});

describe("legacy dispatch reads", () => {
  test("serves a valid pre-2026 ISO week without applying generation admission", async () => {
    const db = {
      prepare(query: string) {
        return {
          bind() { return this; },
          async first() {
            if (query.includes("SELECT d.r2_key, d.generated_at")) {
              return { r2_key: "editions/octocat/2025-W52/legacy.html", generated_at: 1 };
            }
            if (query.includes("SELECT 1 FROM dispatches")) return null;
            throw new Error(`unexpected legacy-read query: ${query}`);
          },
        };
      },
    };
    const dispatches = {
      async get(key: string) {
        if (key !== "editions/octocat/2025-W52/legacy.html") return null;
        return {
          async text() {
            return "<!doctype html><html><head></head><body><main><article class=\"article\"><h1>Legacy week remains readable</h1><p class=\"deck\">Archived before generation launched.</p></article></main></body></html>";
          },
        };
      },
    };
    const app = new Hono().route("/", pageRoutes as never);

    const response = await app.request("/octocat/2025-W52", {}, { DB: db, DISPATCHES: dispatches } as never);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Legacy week remains readable");
  });
});
