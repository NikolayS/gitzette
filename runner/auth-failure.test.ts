import { describe, expect, test } from "bun:test";
import { isOAuthAuthFailure } from "./auth-failure";

describe("OAuth auth failure classification", () => {
  test("isolates OpenClaw auth failures from provider quota and unrelated credentials", () => {
    expect(isOAuthAuthFailure("OpenClaw inference failed (1): OAuth session expired")).toBe(true);
    expect(isOAuthAuthFailure("OpenClaw inference failed (1): login required")).toBe(true);
    expect(isOAuthAuthFailure("OpenClaw inference failed (1): HTTP 401 unauthorized")).toBe(true);
    expect(isOAuthAuthFailure("OpenClaw inference failed (1): session limit reached")).toBe(false);
    expect(isOAuthAuthFailure("OpenClaw inference failed (1): HTTP 529 overloaded")).toBe(false);
    expect(isOAuthAuthFailure("GitHub token revoked")).toBe(false);
  });
});
