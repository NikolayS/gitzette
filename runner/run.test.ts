import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Edition, EvidenceBundle, PublicationManifest } from "../src/edition";
import type { RunnerConfig } from "./config";
import { RunnerEngine } from "./run";
import type { ClaimedJob, Collector, Inference, Publisher, RunnerStage } from "./types";

const job: ClaimedJob = { id: "2bb65583-b570-4a55-b4e4-5de336b10664", username: "octocat", weekKey: "2026-W32", leaseToken: "5ba2cbaf-5dc5-4a3a-8be0-d4230dd11e09", leaseExpiresAt: 1_800_000_000, attempt: 1 };

class FakePublisher implements Publisher {
  stages: RunnerStage[] = [];
  uploads: string[] = [];
  published?: PublicationManifest;
  failure?: string;
  constructor(private queued: ClaimedJob | null = job) {}
  async claim() { const value = this.queued; this.queued = null; return value; }
  async stage(_job: ClaimedJob, stage: RunnerStage) { this.stages.push(stage); }
  async upload(_job: ClaimedJob, key: string) { this.uploads.push(key); }
  async publish(_job: ClaimedJob, manifest: PublicationManifest) { this.published = manifest; }
  async fail(_job: ClaimedJob, message: string) { this.failure = message; }
}

const edition: Edition = {
  headline: "The parser holds", tagline: "One boundary at a time.", closingNote: "The presses continue.",
  stories: [
    { headline: "Parser fixed", deck: "The edge closes.", paragraphs: ["A bounded claim."], evidenceIds: ["commit:abc"], tag: "FEATURE", illustrationKey: "image-1.webp" },
    { headline: "Boundary tested", deck: "The test remains.", paragraphs: ["A second bounded claim."], evidenceIds: ["commit:abc"], tag: "COMMUNITY", illustrationKey: "image-2.webp" },
  ],
};

describe("runner engine", () => {
  test("publishes a quiet week without invoking AI", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gitzette-runner-test-"));
    const publisher = new FakePublisher();
    const collector: Collector = { collect: async () => ({ state: "quiet", username: job.username, weekKey: job.weekKey, items: [] }) };
    const inference: Inference = { write: async () => { throw new Error("AI must not run"); }, illustrate: async () => { throw new Error("AI must not run"); }, reviewIllustration: async () => { throw new Error("AI must not run"); } };
    expect(await new RunnerEngine(config(directory), publisher, collector, inference).runOnce()).toBe("processed");
    expect(publisher.stages).toEqual(["writing", "illustrating", "validating"]);
    expect(publisher.published?.model).toBe("deterministic");
  });

  test("runs active evidence through two images and atomic publication", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gitzette-runner-test-"));
    const publisher = new FakePublisher();
    const evidence: EvidenceBundle = { state: "active", username: job.username, weekKey: job.weekKey, items: [{ id: "commit:abc", type: "commit", title: "Parser fix", url: "https://github.com/octocat/widget/commit/abc", repo: "octocat/widget" }] };
    let image = 0;
    const inference: Inference = {
      write: async () => edition,
      illustrate: async (_subject, output) => {
        image++;
        const child = Bun.spawn(["/usr/bin/convert", "-size", "1024x1024", "xc:#f7f4ee", "-fill", image === 1 ? "red" : "blue", "-draw", "circle 512,512 760,512", output]);
        expect(await child.exited).toBe(0);
      },
      reviewIllustration: async () => {},
    };
    const result = await new RunnerEngine(config(directory), publisher, { collect: async () => evidence }, inference).runOnce();
    expect(result, publisher.failure).toBe("processed");
    expect(publisher.uploads).toEqual(["image-1.webp", "image-2.webp"]);
    expect(publisher.published?.images).toHaveLength(2);
    expect(publisher.failure).toBeUndefined();
  });

  test("fails closed when model output cannot be validated", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gitzette-runner-test-"));
    const publisher = new FakePublisher();
    const collector: Collector = { collect: async () => ({ state: "active", username: job.username, weekKey: job.weekKey, items: [{ id: "commit:abc", type: "commit", title: "x", url: "https://github.com/octocat/widget/commit/abc", repo: "octocat/widget" }] }) };
    const inference: Inference = { write: async () => { throw new Error("unknown edition field: prompt"); }, illustrate: async () => {}, reviewIllustration: async () => {} };
    expect(await new RunnerEngine(config(directory), publisher, collector, inference).runOnce()).toBe("failed");
    expect(publisher.published).toBeUndefined();
    expect(publisher.failure).toContain("prompt");
  });
});

function config(directory: string): RunnerConfig {
  return { controlPlaneOrigin: "https://gitzette.online", runnerSecret: "x", githubToken: "x", openclawBin: "/usr/local/bin/openclaw", openclawHome: directory, pollSeconds: 10, workDir: directory, generatorVersion: "test" };
}
