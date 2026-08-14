import type { Edition, EvidenceBundle, PublicationManifest } from "../src/edition";

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
  write(evidence: EvidenceBundle): Promise<Edition>;
  illustrate(subject: string, outputPath: string): Promise<void>;
  reviewIllustration(subject: string, imagePath: string): Promise<void>;
};

export type Publisher = {
  claim(): Promise<ClaimedJob | null>;
  stage(job: ClaimedJob, stage: RunnerStage): Promise<void>;
  upload(job: ClaimedJob, key: string, bytes: Uint8Array): Promise<void>;
  publish(job: ClaimedJob, manifest: PublicationManifest): Promise<void>;
  fail(job: ClaimedJob, message: string, retryable: boolean): Promise<void>;
};

export type Collector = {
  collect(username: string, weekKey: string): Promise<EvidenceBundle>;
};
