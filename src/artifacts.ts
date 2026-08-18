import { isUuid } from "./identifiers";

const MAX_DELETE_ROUNDS = 20;

type ArtifactCleanupEnv = { DB: D1Database; DISPATCHES: R2Bucket };

export async function deleteJobStaging(env: ArtifactCleanupEnv, jobId: string): Promise<void> {
  if (!isUuid(jobId)) throw new Error("R2 cleanup job id must be a UUID");
  try {
    await deleteR2Prefix(env.DISPATCHES, `staging/${jobId}/`);
    await env.DB.prepare("DELETE FROM artifact_cleanup_jobs WHERE job_id=?").bind(jobId).run();
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "unknown cleanup error";
    await env.DB.prepare(
      `INSERT INTO artifact_cleanup_jobs(job_id,attempts,last_error,updated_at)
       VALUES (?,1,?,unixepoch())
       ON CONFLICT(job_id) DO UPDATE SET
         attempts=artifact_cleanup_jobs.attempts+1,
         last_error=excluded.last_error,
         updated_at=excluded.updated_at`,
    ).bind(jobId, message).run();
    throw error;
  }
}

export async function deleteR2Prefix(bucket: R2Bucket, prefix: string): Promise<void> {
  const match = /^staging\/([^/]+)\/(?:([^/]+)\/)?$/.exec(prefix);
  if (!match || !isUuid(match[1]) || (match[2] !== undefined && !isUuid(match[2]))) {
    throw new Error("R2 cleanup prefix must identify one staging job or lease");
  }
  let previousPage = "";
  for (let round = 0; round < MAX_DELETE_ROUNDS; round += 1) {
    const page = await bucket.list({ prefix, limit: 1000 });
    if (page.objects.length === 0) return;
    const keys = page.objects.map((object) => object.key);
    const signature = JSON.stringify(keys);
    if (signature === previousPage) throw new Error(`R2 cleanup made no progress for ${prefix}`);
    await bucket.delete(keys);
    previousPage = signature;
  }
  // Exhaustion is a hard failure: callers must never mistake partial cleanup
  // for success or silently leave staged content behind.
  throw new Error(`R2 cleanup exceeded ${MAX_DELETE_ROUNDS} rounds for ${prefix}`);
}
