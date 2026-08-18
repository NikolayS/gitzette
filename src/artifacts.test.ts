import { describe, expect, test } from "bun:test";
import { deleteR2Prefix } from "./artifacts";

describe("R2 artifact cleanup", () => {
  test("deletes every page under one prefix without touching another job", async () => {
    const jobId = "2bb65583-b570-4a55-b4e4-5de336b10664";
    const objects = new Set([
      ...Array.from({ length: 1_005 }, (_, index) => `staging/${jobId}/lease/image-${index}.webp`),
      "staging/839d37cd-7e82-4a10-8442-100176b96805/lease/image.webp",
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

    await deleteR2Prefix(bucket as never, `staging/${jobId}/`);
    expect([...objects]).toEqual(["staging/839d37cd-7e82-4a10-8442-100176b96805/lease/image.webp"]);
  });

  test("rejects broad prefixes and fails when deletion makes no progress", async () => {
    const jobId = "2bb65583-b570-4a55-b4e4-5de336b10664";
    const stuck = {
      async list() { return { objects: [{ key: `staging/${jobId}/lease/image.webp` }], truncated: false }; },
      async delete() {},
    };
    await expect(deleteR2Prefix(stuck as never, "")).rejects.toThrow("one staging job or lease");
    await expect(deleteR2Prefix(stuck as never, "staging/")).rejects.toThrow("one staging job or lease");
    await expect(deleteR2Prefix(stuck as never, "jobs/")).rejects.toThrow("one staging job or lease");
    await expect(deleteR2Prefix(stuck as never, `staging/${jobId}/not-a-lease/`)).rejects.toThrow("one staging job or lease");
    await expect(deleteR2Prefix(stuck as never, `staging/${jobId}/`)).rejects.toThrow("made no progress");
  });

  test("signals exhaustion instead of silently leaving staged objects", async () => {
    const jobId = "2bb65583-b570-4a55-b4e4-5de336b10664";
    const objects = new Set(Array.from(
      { length: 20_001 },
      (_, index) => `staging/${jobId}/lease/image-${index}.webp`,
    ));
    const bucket = {
      async list({ prefix, limit }: { prefix: string; limit: number }) {
        return {
          objects: [...objects].filter((key) => key.startsWith(prefix)).slice(0, limit).map((key) => ({ key })),
          truncated: objects.size > limit,
        };
      },
      async delete(keys: string[]) {
        for (const key of keys) objects.delete(key);
      },
    };

    await expect(deleteR2Prefix(bucket as never, `staging/${jobId}/`)).rejects.toThrow("exceeded 20 rounds");
    expect(objects.size).toBe(1);
  });
});
