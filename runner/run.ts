import { TEXT_MODEL } from "../src/models";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { quietEdition, validateManifest, type PublicationManifest } from "../src/edition";
import type { RunnerConfig } from "./config";
import { EDITOR_PROMPT_VERSION } from "./inference";
import { perceptualDistance, postProcessImage, sha256, validateVisual } from "./images";
import type { ClaimedJob, Collector, Inference, Publisher } from "./types";
import { combineTokenUsage, type JobUsage, type TokenUsage } from "../src/usage";
import { isOAuthAuthFailure } from "./auth-failure";

export type RunnerResult = "idle" | "processed" | "failed" | "auth_failed";

export class RunnerEngine {
  constructor(
    private readonly config: RunnerConfig,
    private readonly publisher: Publisher,
    private readonly collector: Collector,
    private readonly inference: Inference,
  ) {}

  async runOnce(): Promise<RunnerResult> {
    const job = await this.publisher.claim();
    if (!job) return "idle";
    try {
      await this.process(job);
      return "processed";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const authFailure = isOAuthAuthFailure(error);
      await this.publisher.fail(job, authFailure ? `runner_auth_unavailable: ${message}` : message, !authFailure);
      return authFailure ? "auth_failed" : "failed";
    } finally {
      await rm(jobDir(this.config, job), { recursive: true, force: true });
    }
  }

  private async process(job: ClaimedJob): Promise<void> {
    let heartbeatError: unknown;
    let heartbeatInFlight: Promise<void> | undefined;
    const heartbeat = () => {
      if (heartbeatInFlight) return;
      heartbeatInFlight = this.publisher.heartbeat(job)
        .catch((error) => { heartbeatError = error; })
        .finally(() => { heartbeatInFlight = undefined; });
    };
    const timer = setInterval(heartbeat, this.config.heartbeatSeconds * 1000);
    try {
      await this.processWithLease(job, () => {
        if (heartbeatError) throw new Error(`lease heartbeat failed: ${String(heartbeatError)}`);
      });
    } finally {
      clearInterval(timer);
      if (heartbeatInFlight) await heartbeatInFlight;
    }
  }

  private async processWithLease(job: ClaimedJob, assertLease: () => void): Promise<void> {
    const startedAt = performance.now();
    let tokenUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, tokenSource: "none" };
    const addUsage = (usage: TokenUsage) => { tokenUsage = combineTokenUsage(tokenUsage, usage); };
    const jobUsage = (imageCount: number): JobUsage => ({
      ...tokenUsage,
      imageCount,
      wallTimeMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
    const evidence = await this.collector.collect(job.username, job.weekKey);
    assertLease();
    if (evidence.state === "collection_failed") throw new Error("collection failed");
    await this.publisher.stage(job, "writing");

    if (evidence.state === "quiet") {
      await this.publisher.stage(job, "illustrating");
      await this.publisher.stage(job, "validating");
      const manifest: PublicationManifest = {
        generatorVersion: this.config.generatorVersion,
        model: "deterministic",
        promptVersion: EDITOR_PROMPT_VERSION,
        evidence,
        edition: quietEdition(job.username, job.weekKey),
        images: [],
      };
      validateManifest(manifest, job.username, job.weekKey);
      await this.publisher.publish(job, manifest, jobUsage(0));
      return;
    }

    const written = await this.inference.write(evidence);
    addUsage(written.usage);
    const edition = written.edition;
    assertLease();
    await this.publisher.stage(job, "illustrating");
    const directory = jobDir(this.config, job);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const images: PublicationManifest["images"] = [];
    const hashes = new Set<string>();
    const imageRuntime = {
      spawn: Bun.spawn,
      convertBin: this.config.imageMagickBin,
      compareBin: this.config.imageMagickCompareBin,
    };
    for (const key of ["image-1.webp", "image-2.webp"] as const) {
      const story = edition.stories.find((candidate) => candidate.illustrationKey === key);
      if (!story) throw new Error(`edition omitted ${key}`);
      const input = join(directory, `${key}.png`);
      const output = join(directory, key);
      addUsage(await this.inference.illustrate(`${story.headline}. ${story.deck}`, input));
      assertLease();
      const bytes = await postProcessImage(input, output, imageRuntime);
      await validateVisual(output, imageRuntime);
      addUsage(await this.inference.reviewIllustration(`${story.headline}. ${story.deck}`, output));
      assertLease();
      if (images.length > 0) {
        const distance = await perceptualDistance(join(directory, images[0].key), output, imageRuntime);
        if (distance < 0.08) throw new Error(`illustrations are too visually similar: ${distance}`);
      }
      const digest = await sha256(bytes);
      if (hashes.has(digest)) throw new Error("generated illustrations are perceptually identical bytes");
      hashes.add(digest);
      await this.publisher.upload(job, key, bytes);
      images.push({ key, contentType: "image/webp", sha256: digest });
    }

    await this.publisher.stage(job, "validating");
    const manifest: PublicationManifest = {
      generatorVersion: this.config.generatorVersion,
      model: TEXT_MODEL,
      promptVersion: EDITOR_PROMPT_VERSION,
      evidence,
      edition,
      images,
    };
    validateManifest(manifest, job.username, job.weekKey);
    await this.publisher.publish(job, manifest, jobUsage(images.length));
  }
}

function jobDir(config: RunnerConfig, job: ClaimedJob): string {
  return join(config.workDir, job.id);
}
