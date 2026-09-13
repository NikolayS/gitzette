import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { pageRoutes } from "./pages";
import { queueRoutes } from "./queue";
import type { ProfilePublicationState } from "./profile-suppression";

describe("runtime profile suppression", () => {
  test("requires every combined check to carry the runtime suppression column", () => {
    // @ts-expect-error A query that omits the D1 suppression projection must fail typecheck.
    const incomplete: ProfilePublicationState = { username: "octocat" };
    expect(incomplete.username).toBe("octocat");
  });

  test("serves a stored pre-Astra edition without model revalidation", async () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(await Bun.file("schema.sql").text());
    sqlite.query("INSERT INTO users(id,username) VALUES ('1','octocat')").run();
    sqlite.query("INSERT INTO dispatches(user_id,week_key,r2_key) VALUES ('1','2026-W32','legacy.html')").run();
    const env = { DB: new SqliteD1(sqlite), DISPATCHES: { async get(key: string) {
      expect(key).toBe("legacy.html");
      return { customMetadata: { model: "openai/gpt-5.6-sol" }, async text() { return '<article class="article"><h2>Pre-Astra headline</h2><p>Stored body</p></article>'; } };
    } } } as never;
    const app = new Hono().route("/", pageRoutes as never);
    const response = await app.request("/octocat/2026-W32", {}, env);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Pre-Astra headline");
    sqlite.close();
  });

  test("immediately hides public content and blocks generation without a deploy", async () => {
    const sqlite = new Database(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    sqlite.exec(await Bun.file("schema.sql").text());
    sqlite.query("INSERT INTO users(id,username) VALUES ('1','octocat')").run();
    sqlite.query("INSERT INTO sessions(token,user_id,expires_at) VALUES ('session','1',unixepoch()+3600)").run();
    sqlite.query("INSERT INTO dispatches(user_id,week_key,r2_key) VALUES ('1','2026-W32','editions/octocat/2026-W32/live.html')").run();
    sqlite.query("INSERT INTO profile_suppressions(username,reason) VALUES ('OCTOCAT','verified opt-out')").run();
    const db = new SqliteD1(sqlite);
    const dispatches = {
      async get(key: string) {
        if (key.startsWith("illustrations/")) {
          return {
            customMetadata: { ownerUserId: "1", ownerUsername: "octocat" },
            arrayBuffer: async () => new ArrayBuffer(1),
          };
        }
        throw new Error(`suppressed edition must not be fetched: ${key}`);
      },
    };
    const app = new Hono()
      .route("/", pageRoutes as never)
      .route("/", queueRoutes as never);
    const env = { DB: db, DISPATCHES: dispatches } as never;

    expect(await (await app.request("/", {}, env)).text()).not.toContain("@octocat");
    expect((await app.request("/octocat", {}, env)).status).toBe(404);
    expect((await app.request("/octocat/2026-W32", {}, env)).status).toBe(404);
    expect((await app.request("/img/1-deadbeef.webp", {}, env)).status).toBe(404);
    const generated = await app.request("/generate", {
      method: "POST",
      headers: { cookie: "session=session", "content-type": "application/json" },
      body: "{}",
    }, env);
    expect(generated.status).toBe(410);
    expect(await generated.json() as { error: string }).toEqual({ error: "profile unavailable" });

    expect(() => sqlite.query(
      "INSERT INTO profile_suppressions(username,reason) VALUES ('octocat','duplicate')",
    ).run()).toThrow();
    sqlite.close();
  });
});

type SqlValue = string | number | bigint | boolean | Uint8Array | null;

class SqliteStatement {
  private args: unknown[] = [];
  constructor(private readonly db: Database, private readonly query: string) {}
  bind(...args: unknown[]) { this.args = args; return this; }
  async first<T>() { return this.db.query(this.query).get(...this.args as SqlValue[]) as T | null; }
  async all<T>() { return { results: this.db.query(this.query).all(...this.args as SqlValue[]) as T[] } as D1Result<T>; }
  async run() {
    const result = this.db.query(this.query).run(...this.args as SqlValue[]);
    return { meta: { changes: Number(result.changes) } };
  }
}

class SqliteD1 {
  constructor(private readonly db: Database) {}
  prepare(query: string) { return new SqliteStatement(this.db, query); }
}
