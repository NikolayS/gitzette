import { describe, expect, test } from "bun:test";
import { weeklyGenerationEnabled } from "./weekly-generation-flag";

describe("weekly generation activation flag", () => {
  test("accepts only explicit string booleans", () => {
    expect(weeklyGenerationEnabled('[vars]\nWEEKLY_GENERATION_ENABLED = "true"')).toBe(true);
    expect(weeklyGenerationEnabled('[vars]\nWEEKLY_GENERATION_ENABLED = "false"')).toBe(false);
    expect(() => weeklyGenerationEnabled("[vars]")).toThrow("invalid WEEKLY_GENERATION_ENABLED");
    expect(() => weeklyGenerationEnabled("[vars]\nWEEKLY_GENERATION_ENABLED = true")).toThrow(
      "invalid WEEKLY_GENERATION_ENABLED",
    );
  });
});
