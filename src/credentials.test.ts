import { describe, expect, test } from "bun:test";
import { bearerToken, secretMatches } from "./credentials";

describe("service credential boundary", () => {
  test("uses a hashed comparison and fails closed when unconfigured", async () => {
    expect(await secretMatches("service-secret", "service-secret")).toBe(true);
    expect(await secretMatches("service-secret", "different")).toBe(false);
    expect(await secretMatches("undefined", undefined)).toBe(false);
    expect(await secretMatches("anything", "")).toBe(false);
  });

  test("parses the bearer scheme case-insensitively and ignores trailing OWS", () => {
    expect(bearerToken("bearer service-secret ")).toBe("service-secret");
    expect(bearerToken("BEARER\tservice-secret\t")).toBe("service-secret");
    expect(bearerToken("Basic service-secret")).toBe("");
  });
});
