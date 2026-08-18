import { describe, expect, test } from "bun:test";
import { isGitHubUsername, isUuid, normalizeGitHubUsername } from "./identifiers";

describe("external identifiers", () => {
  test("accepts valid GitHub usernames at the length boundary", () => {
    expect(isGitHubUsername("octocat")).toBe(true);
    expect(isGitHubUsername("a".repeat(39))).toBe(true);
  });

  test("canonicalizes valid GitHub usernames to one lowercase identity", () => {
    expect(normalizeGitHubUsername("Alice")).toBe("alice");
    expect(normalizeGitHubUsername("alice")).toBe("alice");
    expect(normalizeGitHubUsername("bad_name")).toBeNull();
  });

  test("rejects invalid GitHub hyphen placement and length", () => {
    for (const value of ["", "-octocat", "octocat-", "octo--cat", "a".repeat(40), "octo_cat"]) {
      expect(isGitHubUsername(value)).toBe(false);
    }
  });

  test("accepts UUID v4 and rejects other versions or invalid variants", () => {
    expect(isUuid("00000000-0000-4000-8000-000000000000")).toBe(true);
    expect(isUuid("00000000-0000-1000-8000-000000000000")).toBe(false);
    expect(isUuid("00000000-0000-9000-8000-000000000000")).toBe(false);
    expect(isUuid("00000000-0000-4000-7000-000000000000")).toBe(false);
    expect(isUuid("2BB65583-B570-4A55-B4E4-5DE336B10664")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});
