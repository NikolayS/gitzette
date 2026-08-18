import { describe, expect, test } from "bun:test";
import { deleteR2Prefix } from "./artifacts";

describe("R2 artifact cleanup", () => {
  test("deletes every page under one prefix without touching another job", async () => {
    const objects = new Set([
      ...Array.from({ length: 1_005 }, (_, index) => `staging/job/lease/image-${index}.webp`),
      "staging/other/lease/image.webp",
    ]);
    const bucket = {
      async list({ prefix, limit }: { prefix: string; limit: number }) {
        return {
          objects: [...objects].filter((key) => key.startsWith(prefix)).slice(0, limit).map((key) => ({ key })),
          truncated: false,
        };
      },
      async delete(keys: string[]) {
        for (const key of keys) objects.delete(key);
      },
    };

    await deleteR2Prefix(bucket as never, "staging/job/");
    expect([...objects]).toEqual(["staging/other/lease/image.webp"]);
  });
});
