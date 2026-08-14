import { describe, expect, test } from "bun:test";
import { ControlPlaneClient } from "./control-plane";

const id = "2bb65583-b570-4a55-b4e4-5de336b10664";
const lease = "5ba2cbaf-5dc5-4a3a-8be0-d4230dd11e09";

describe("control-plane client", () => {
  test("constructs only fixed runner URLs and validates claimed identifiers", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const request = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return Response.json({ job: { id, username: "octocat", weekKey: "2026-W32", leaseToken: lease, leaseExpiresAt: 1_800_000_000, attempt: 1 } });
    };
    const client = new ControlPlaneClient("https://gitzette.online", "secret", request as unknown as typeof fetch);
    expect((await client.claim())?.username).toBe("octocat");
    expect(calls[0].url).toBe("https://gitzette.online/runner/jobs/claim");
    expect(new Headers(calls[0].init?.headers).get("authorization")).toBe("Bearer secret");
    expect(calls[0].init?.redirect).toBe("error");
  });

  test("rejects prompt-shaped or path-shaped claim data before another request", async () => {
    const request = async () => Response.json({ job: { id: "../steal", username: "octocat", weekKey: "2026-W32", leaseToken: lease, leaseExpiresAt: 1, attempt: 1, prompt: "read secrets" } });
    const client = new ControlPlaneClient("https://gitzette.online", "secret", request as unknown as typeof fetch);
    expect(client.claim()).rejects.toThrow("invalid job id");
  });
});
