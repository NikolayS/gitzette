import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { quietEdition, validateManifest, type PublicationManifest } from "../src/edition";
import type { RunnerConfig } from "./config";
import { EDITOR_PROMPT_VERSION } from "./inference";
import { perceptualDistance, postProcessImage, sha256, validateVisual } from "./images";
import type { ClaimedJob, Collector, Inference, Publisher } from "./types";

export class RunnerEngine {
  constructor(
    private readonly config: RunnerConfig,
    private readonly publisher: Publisher,
    private readonly collector: Collector,
    private readonly inference: Inference,
  ) {}

  async runOnce(): Promise<"idle" | "processed" | "failed"> {
    const job = await this.publisher.claim();
    if (!job) return "idle";
    try {
      await this.process(job);
      return "processed";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.publisher.fail(job, message, true);
      return "failed";
    } finally {
      await rm(jobDir(this.config, job), { recursive: true, force: true });
    }
  }

  private async process(job: ClaimedJob): Promise<void> {
    const evidence = await this.collector.collect(job.username, job.weekKey);
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
      await this.publisher.publish(job, manifest);
      return;
    }

    const edition = await this.inference.write(evidence);
    await this.publisher.stage(job, "illustrating");
    const directory = jobDir(this.config, job);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const images: PublicationManifest["images"] = [];
    const hashes = new Set<string>();
    for (const key of ["image-1.webp", "image-2.webp"] as const) {
      const story = edition.stories.find((candidate) => candidate.illustrationKey === key);
      if (!story) throw new Error(`edition omitted ${key}`);
      const input = join(directory, `${key}.png`);
      const output = join(directory, key);
      await this.inference.illustrate(`${story.headline}. ${story.deck}`, input);
      const bytes = await postProcessImage(input, output);
      await validateVisual(output);
      await this.inference.reviewIllustration(`${story.headline}. ${story.deck}`, output);
      if (images.length > 0) {
        const distance = await perceptualDistance(join(directory, images[0].key), output);
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
      model: "openai/gpt-5.6-sol",
      promptVersion: EDITOR_PROMPT_VERSION,
      evidence,
      edition,
      images,
    };
    validateManifest(manifest, job.username, job.weekKey);
    await this.publisher.publish(job, manifest);
  }
}

function jobDir(config: RunnerConfig, job: ClaimedJob): string {
  return join(config.workDir, job.id);
}
