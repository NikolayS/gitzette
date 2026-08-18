import { describe, expect, test } from "bun:test";
import { isProfileSuppressedByPolicy } from "./highlighted";

describe("managed profile publication policy", () => {
  test("suppresses a managed profile removed from the active weekly allowlist", () => {
    const managed = new Set(["dhh"]);
    expect(isProfileSuppressedByPolicy("DHH", managed, new Set())).toBe(true);
    expect(isProfileSuppressedByPolicy("DHH", managed, new Set(["dhh"]))).toBe(false);
    expect(isProfileSuppressedByPolicy("ordinary-user", managed, new Set())).toBe(false);
  });
});
