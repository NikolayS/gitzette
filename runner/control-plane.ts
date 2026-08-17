import type { ClaimedJob, Publisher, RunnerStage } from "./types";
import type { PublicationManifest } from "../src/edition";
import type { JobUsage } from "../src/usage";
import { isGitHubUsername, isUuid } from "../src/identifiers";
import { isCompletedIsoWeekKey } from "../src/week";


type RequestFn = typeof fetch;

export class ControlPlaneClient implements Publisher {
  constructor(
    private readonly origin: string,
    private readonly secret: string,
    private readonly request: RequestFn = fetch,
  ) {}

  async claim(): Promise<ClaimedJob | null> {
    const response = await this.send("/runner/jobs/claim", { method: "POST" });
    if (response.status === 204) return null;
    const body = await readJson(response) as { job?: Record<string, unknown> };
    if (!body.job) throw new Error("control plane returned no job");
    return parseClaim(body.job);
  }

  async stage(job: ClaimedJob, stage: RunnerStage): Promise<void> {
    await this.expectOk(`/runner/jobs/${job.id}/stage`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leaseToken: job.leaseToken, stage }),
    });
  }

  async heartbeat(job: ClaimedJob): Promise<void> {
    await this.expectOk(`/runner/jobs/${job.id}/heartbeat`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leaseToken: job.leaseToken }),
    });
  }

  async upload(job: ClaimedJob, key: string, bytes: Uint8Array): Promise<void> {
    if (!/^image-[1-3]\.webp$/.test(key)) throw new Error("invalid artifact key");
    await this.expectOk(`/runner/jobs/${job.id}/artifacts/${key}`, {
      method: "PUT",
      headers: { "content-type": "image/webp", "x-gitzette-lease": job.leaseToken },
      body: new Uint8Array(bytes).buffer,
    });
  }

  async publish(job: ClaimedJob, manifest: PublicationManifest, usage: JobUsage): Promise<void> {
    await this.expectOk(`/runner/jobs/${job.id}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leaseToken: job.leaseToken, manifest, usage }),
    });
  }

  async fail(job: ClaimedJob, message: string, retryable: boolean): Promise<void> {
    await this.expectOk(`/runner/jobs/${job.id}/fail`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leaseToken: job.leaseToken, error: message.slice(0, 1000), retryable }),
    });
  }

  private async expectOk(path: string, init: RequestInit): Promise<void> {
    const response = await this.send(path, init);
    if (!response.ok) throw new Error(`control plane ${path} returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  private send(path: string, init: RequestInit): Promise<Response> {
    if (!path.startsWith("/runner/") || path.includes("..") || path.includes("?")) throw new Error("invalid control-plane path");
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.secret}`);
    return this.request(`${this.origin}${path}`, { ...init, headers, redirect: "error", signal: AbortSignal.timeout(30_000) });
  }
}

function parseClaim(value: Record<string, unknown>): ClaimedJob {
  const job = {
    id: value.id,
    username: value.username,
    weekKey: value.weekKey,
    leaseToken: value.leaseToken,
    leaseExpiresAt: value.leaseExpiresAt,
    attempt: value.attempt,
  };
  if (typeof job.id !== "string" || !isUuid(job.id)) throw new Error("invalid job id");
  if (typeof job.username !== "string" || !isGitHubUsername(job.username)) throw new Error("invalid job username");
  if (typeof job.weekKey !== "string" || !isCompletedIsoWeekKey(job.weekKey)) throw new Error("invalid job week");
  if (typeof job.leaseToken !== "string" || !isUuid(job.leaseToken)) throw new Error("invalid lease token");
  if (!Number.isInteger(job.leaseExpiresAt) || !Number.isInteger(job.attempt)) throw new Error("invalid job lease metadata");
  return job as ClaimedJob;
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`control plane claim returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > 2_000_000) throw new Error("control-plane response too large");
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error("control-plane response too large");
  return JSON.parse(text);
}
