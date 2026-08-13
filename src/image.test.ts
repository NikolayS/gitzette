import { describe, expect, test } from "bun:test";
import { hasPublicationDimensions, webpDimensions } from "./image";

const valid = Uint8Array.from(atob("UklGRiIAAABXRUJQVlA4TBYAAAAv/8A/AAcQEf0PACjS//8U0f/U//4D"), (char) => char.charCodeAt(0));

describe("WebP validation", () => {
  test("reads real lossless WebP dimensions", () => {
    expect(webpDimensions(valid)).toEqual({ width: 256, height: 256 });
  });

  test("rejects truncation and a forged RIFF length", () => {
    expect(webpDimensions(valid.slice(0, 20))).toBeNull();
    const forged = valid.slice();
    forged[4] = 0;
    expect(webpDimensions(forged)).toBeNull();
  });

  test("enforces publication dimensions", () => {
    expect(hasPublicationDimensions({ width: 256, height: 2048 })).toBe(true);
    expect(hasPublicationDimensions({ width: 1, height: 1 })).toBe(false);
    expect(hasPublicationDimensions({ width: 4096, height: 1024 })).toBe(false);
  });
});
