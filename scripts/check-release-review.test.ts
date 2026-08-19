import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { releaseReview } from "./check-release-review";

const temporaryDirectories: string[] = [];
const releaseSha = "release";
const reviewedSha = "reviewed";
const base = {
  release_sha: releaseSha,
  main_sha: releaseSha,
  pulls: [[{ base: { ref: "main" }, head: { sha: reviewedSha }, merged_at: "2026-08-19T00:00:00Z", merge_commit_sha: releaseSha }]],
  check_run_pages: [{ check_runs: [
    { name: "typecheck", conclusion: "success", app: { id: 15368 } },
    { name: "base-controlled samorev publisher", conclusion: "success", app: { id: 15368 } },
  ] }],
  status_pages: [[
    { id: 1, context: "samorev", state: "success", created_at: "2026-08-19T00:01:00Z", creator: { id: 280144521 } },
    { id: 2, context: "samorev-gate", state: "success", created_at: "2026-08-19T00:02:00Z", creator: { id: 41898282 } },
  ]],
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("release review gate", () => {
  test("requires exactly one merged PR and exact identity-bearing checks", () => {
    expect(releaseReview(base)).toEqual({ reviewedSha });
    expect(() => releaseReview({ ...base, main_sha: "stale" })).toThrow("current main tip");
    expect(() => releaseReview({ ...base, pulls: [...base.pulls, ...base.pulls] })).toThrow("exactly one merged main pull request");
    const forged = structuredClone(base);
    forged.status_pages[0].push({
      id: 3,
      context: "samorev",
      state: "success",
      created_at: "2026-08-19T00:03:00Z",
      creator: { id: 41898282 },
    });
    expect(() => releaseReview(forged)).toThrow("immutable successful reviewer identity");
  });

  test("executes the checked-in fixture entrypoint", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gitzette-release-review-"));
    temporaryDirectories.push(directory);
    const fixture = join(directory, "review.json");
    await Bun.write(fixture, JSON.stringify(base));
    const child = Bun.spawn(["bun", "scripts/check-release-review.ts", fixture], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ reviewedSha });
  });
});
