import type { Edition, EvidenceBundle, PublicationManifest } from "../src/edition";
import type { JobUsage, TokenUsage } from "../src/usage";

export type ClaimedJob = {
  id: string;
  username: string;
  weekKey: string;
  leaseToken: string;
  leaseExpiresAt: number;
  attempt: number;
};

export type RunnerStage = "writing" | "illustrating" | "validating";

export type Inference = {
  write(evidence: EvidenceBundle): Promise<{ edition: Edition; usage: TokenUsage }>;
  illustrate(subject: string, outputPath: string): Promise<TokenUsage>;
  reviewIllustration(subject: string, imagePath: string): Promise<TokenUsage>;
};

export type Publisher = {
  claim(): Promise<ClaimedJob | null>;
  heartbeat(job: ClaimedJob): Promise<void>;
  stage(job: ClaimedJob, stage: RunnerStage): Promise<void>;
  upload(job: ClaimedJob, key: string, bytes: Uint8Array): Promise<void>;
  publish(job: ClaimedJob, manifest: PublicationManifest, usage: JobUsage): Promise<void>;
  fail(job: ClaimedJob, message: string, retryable: boolean): Promise<void>;
};

export type Collector = {
  collect(username: string, weekKey: string): Promise<EvidenceBundle>;
};
