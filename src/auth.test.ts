import { afterEach, describe, expect, test } from "bun:test";
import { authRoutes } from "./auth";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("GitHub OAuth callback", () => {
  test("persists a mixed-case returning login as one canonical user", async () => {
    const users = [{ id: "42", username: "octocat", avatar_url: "old" }];
    const sessions: { token: string; userId: string }[] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return {
              async run() {
                if (sql.includes("INSERT INTO users")) {
                  const [id, username, avatarUrl] = values as [string, string, string];
                  const existing = users.find((user) => user.id === id);
                  if (existing) Object.assign(existing, { username, avatar_url: avatarUrl });
                  else users.push({ id, username, avatar_url: avatarUrl });
                } else if (sql.includes("INSERT INTO sessions")) {
                  sessions.push({ token: String(values[0]), userId: String(values[1]) });
                } else {
                  throw new Error(`unexpected SQL: ${sql}`);
                }
                return { success: true };
              },
            };
          },
        };
      },
    };

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://github.com/login/oauth/access_token") {
        return Response.json({ access_token: "test-token" });
      }
      if (url === "https://api.github.com/user") {
        return Response.json({ id: 42, login: "OcToCaT", avatar_url: "new" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const response = await authRoutes.request(
      "/callback?code=code&state=state",
      { headers: { cookie: "oauth_state=state" } },
      { DB: db, GITHUB_CLIENT_ID: "client", GITHUB_CLIENT_SECRET: "secret" } as never,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/octocat");
    expect(users).toEqual([{ id: "42", username: "octocat", avatar_url: "new" }]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].userId).toBe("42");
  });
});
