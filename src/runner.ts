import { Hono } from "hono";
import { renderEdition, validateManifest, type PublicationManifest } from "./edition";
import { hasPublicationDimensions, webpDimensions } from "./image";
import { bearerToken, secretMatches } from "./credentials";
import type { Env } from "./index";
import { isManagedProfileSuppressed } from "./highlighted";
import { maxQueueAgeSeconds } from "./queue";
import { validateJobUsage, type JobUsage } from "./usage";
import { deleteR2Prefix } from "./artifacts";

const DEFAULT_LEASE_SECONDS = 10 * 60;
const DEFAULT_GLOBAL_WEEKLY_LIMIT = 100;
const ROLLING_CAPACITY_SECONDS = 7 * 24 * 60 * 60;
const MAX_ATTEMPTS = 5;
const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
const STAGES = new Set(["collecting", "writing", "illustrating", "validating"]);
const NEXT_STAGE: Record<string, string> = {
  collecting: "writing",
  writing: "illustrating",
  illustrating: "validating",
};

export const CLAIM_JOB_SQL = `UPDATE generation_jobs
  SET status='collecting', attempt=attempt+1, capacity_started_at=COALESCE(capacity_started_at,?),
      lease_token=?, lease_expires_at=?, last_error=NULL, updated_at=?
WHERE id=(
  SELECT id FROM generation_jobs
  WHERE attempt < ? AND (
    status IN ('queued','retryable_failed') OR
    (status IN ('collecting','writing','illustrating','validating') AND lease_expires_at < ?)
  )
  AND created_at >= ?
  AND (
    capacity_started_at IS NOT NULL OR (
      SELECT COUNT(*) FROM generation_jobs
      WHERE capacity_started_at>=?
    ) < ?
  )
  ORDER BY created_at, rowid LIMIT 1
)
RETURNING id,user_id,week_key,status,attempt,lease_token,lease_expires_at`;

type ClaimedJob = {
  id: string;
  user_id: string;
  username: string;
  week_key: string;
  status: string;
  attempt: number;
  lease_token: string;
  lease_expires_at: number;
};

export const runnerRoutes = new Hono<{ Bindings: Env }>();

runnerRoutes.use("*", async (c, next) => {
  const supplied = bearerToken(c.req.header("authorization") || "");
  if (!supplied || !await secretMatches(supplied, c.env.RUNNER_SECRET)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

runnerRoutes.post("/jobs/claim", async (c) => {
  const leaseToken = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const leaseExpires = now + leaseSeconds(c.env);
  const globalLimit = positiveInteger(c.env.ROLLING_7D_GLOBAL_GENERATION_LIMIT, DEFAULT_GLOBAL_WEEKLY_LIMIT);
  const exhausted = await c.env.DB.prepare(
    `UPDATE generation_jobs
     SET status='permanent_failed',last_error='generation attempts exhausted',lease_token=NULL,lease_expires_at=NULL,updated_at=?
     WHERE attempt>=? AND status IN ('collecting','writing','illustrating','validating') AND lease_expires_at<?
     RETURNING id`
  ).bind(now, MAX_ATTEMPTS, now).all<{ id: string }>();
  await Promise.all((exhausted.results ?? []).map((job) =>
    deleteR2Prefix(c.env.DISPATCHES, `staging/${job.id}/`)
  ));
  const row = await c.env.DB.prepare(CLAIM_JOB_SQL)
    .bind(
      now,
      leaseToken,
      leaseExpires,
      now,
      MAX_ATTEMPTS,
      now,
      now - maxQueueAgeSeconds(c.env),
      now - ROLLING_CAPACITY_SECONDS,
      globalLimit,
    )
    .first<Omit<ClaimedJob, "username">>();
  if (!row) return c.body(null, 204);
  const user = await c.env.DB.prepare("SELECT username FROM users WHERE id=?").bind(row.user_id).first<{ username: string }>();
  if (isManagedProfileSuppressed(user!.username)) {
    if (!await terminalizeSuppressedJob(c.env, row.id, row.lease_token)) {
      return c.json({ error: "lease changed" }, 409);
    }
    return c.body(null, 204);
  }
  await deleteR2Prefix(c.env.DISPATCHES, `staging/${row.id}/`);
  return c.json({ job: { ...row, username: user!.username, weekKey: row.week_key, leaseToken: row.lease_token, leaseExpiresAt: row.lease_expires_at } });
});

runnerRoutes.patch("/jobs/:id/heartbeat", async (c) => {
  const body = await requestJson<{ leaseToken?: string }>(c);
  if (!body) return c.json({ error: "invalid request body" }, 400);
  if (!body.leaseToken) return c.json({ error: "invalid heartbeat" }, 400);
  const result = await c.env.DB.prepare(
    `UPDATE generation_jobs SET updated_at=unixepoch(),lease_expires_at=unixepoch()+?
     WHERE id=? AND lease_token=? AND lease_expires_at>=unixepoch()
       AND status IN ('collecting','writing','illustrating','validating')`
  ).bind(leaseSeconds(c.env), c.req.param("id"), body.leaseToken).run();
  if ((result.meta.changes ?? 0) !== 1) return c.json({ error: "lease not held" }, 409);
  return c.json({ status: "extended" });
});

runnerRoutes.patch("/jobs/:id/stage", async (c) => {
  const body = await requestJson<{ leaseToken?: string; stage?: string }>(c);
  if (!body) return c.json({ error: "invalid request body" }, 400);
  if (!body.leaseToken || !body.stage || !STAGES.has(body.stage)) return c.json({ error: "invalid stage" }, 400);
  const job = await heldJob(c.env.DB, c.req.param("id"), body.leaseToken);
  if (!job) return c.json({ error: "lease not held" }, 409);
  if (!isForwardStage(job.status, body.stage)) return c.json({ error: `invalid transition: ${job.status} -> ${body.stage}` }, 409);
  const result = await updateLeasedJob(c.env.DB, job.id, body.leaseToken, job.status, body.stage, leaseSeconds(c.env));
  if (!result) return c.json({ error: "lease changed" }, 409);
  return c.json({ status: body.stage });
});

runnerRoutes.put("/jobs/:id/artifacts/:name", async (c) => {
  const name = c.req.param("name");
  const leaseToken = c.req.header("x-gitzette-lease");
  if (!leaseToken || !/^image-[1-3]\.webp$/.test(name)) return c.json({ error: "invalid artifact request" }, 400);
  const job = await heldJob(c.env.DB, c.req.param("id"), leaseToken);
  if (!job) return c.json({ error: "lease not held" }, 409);
  if (job.status !== "illustrating" && job.status !== "validating") return c.json({ error: "job is not accepting artifacts" }, 409);
  if (!isWebpContentType(c.req.header("content-type"))) return c.json({ error: "artifact must be image/webp" }, 415);
  const declared = Number(c.req.header("content-length") || 0);
  if (isArtifactTooLarge(declared)) return c.json({ error: "artifact too large" }, 413);
  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ARTIFACT_BYTES) return c.json({ error: "invalid artifact size" }, 413);
  const dimensions = webpDimensions(new Uint8Array(bytes));
  if (!dimensions) return c.json({ error: "invalid WebP structure" }, 422);
  if (!hasPublicationDimensions(dimensions)) {
    return c.json({ error: "WebP dimensions must be 256..2048 pixels" }, 422);
  }
  await c.env.DISPATCHES.put(`staging/${job.id}/${leaseToken}/${name}`, bytes, {
    httpMetadata: { contentType: "image/webp" },
  });
  return c.json({ stored: name, bytes: bytes.byteLength });
});

runnerRoutes.post("/jobs/:id/fail", async (c) => {
  const body = await requestJson<{ leaseToken?: string; error?: string; retryable?: boolean }>(c);
  if (!body) return c.json({ error: "invalid request body" }, 400);
  if (!body.leaseToken || typeof body.error !== "string") return c.json({ error: "invalid failure" }, 400);
  const job = await heldJob(c.env.DB, c.req.param("id"), body.leaseToken);
  if (!job) return c.json({ error: "lease not held" }, 409);
  const status = body.retryable !== false && job.attempt < MAX_ATTEMPTS ? "retryable_failed" : "permanent_failed";
  await c.env.DB.prepare(
    "UPDATE generation_jobs SET status=?,last_error=?,lease_token=NULL,lease_expires_at=NULL,updated_at=unixepoch() WHERE id=? AND lease_token=?"
  ).bind(status, body.error.slice(0, 1000), job.id, body.leaseToken).run();
  const stagingPrefix = status === "permanent_failed"
    ? `staging/${job.id}/`
    : `staging/${job.id}/${body.leaseToken}/`;
  await deleteR2Prefix(c.env.DISPATCHES, stagingPrefix);
  return c.json({ status });
});

runnerRoutes.post("/jobs/:id/publish", async (c) => {
  const body = await requestJson<{ leaseToken?: string; manifest?: unknown; usage?: unknown }>(c);
  if (!body) return c.json({ error: "invalid request body" }, 400);
  if (!body.leaseToken) return c.json({ error: "missing leaseToken" }, 400);
  const job = await heldJob(c.env.DB, c.req.param("id"), body.leaseToken);
  if (!job) return c.json({ error: "lease not held" }, 409);
  if (job.status !== "validating") return c.json({ error: "job is not ready to publish" }, 409);
  if (isManagedProfileSuppressed(job.username)) {
    if (!await terminalizeSuppressedJob(c.env, job.id, body.leaseToken)) {
      return c.json({ error: "lease changed" }, 409);
    }
    return c.json({ error: "profile unavailable" }, 410);
  }

  let manifest: PublicationManifest;
  try { manifest = validateManifest(body.manifest, job.username, job.week_key); }
  catch (error) { return c.json({ error: String(error) }, 422); }
  let usage: JobUsage;
  try { usage = validateJobUsage(body.usage); }
  catch (error) { return c.json({ error: String(error) }, 422); }
  if (usage.imageCount !== manifest.images.length) return c.json({ error: "usage image count mismatch" }, 422);

  const finalImages = new Map<string, string>();
  for (const image of manifest.images) {
    const stagedKey = `staging/${job.id}/${body.leaseToken}/${image.key}`;
    const object = await c.env.DISPATCHES.get(stagedKey);
    if (!object) return c.json({ error: `missing artifact: ${image.key}` }, 422);
    const bytes = await object.arrayBuffer();
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (digest !== image.sha256) return c.json({ error: `artifact hash mismatch: ${image.key}` }, 422);
    const finalName = `${job.user_id}-${digest}.webp`;
    await c.env.DISPATCHES.put(`illustrations/${finalName}`, bytes, {
      httpMetadata: { contentType: "image/webp" },
      customMetadata: { ownerUserId: job.user_id, ownerUsername: job.username },
    });
    finalImages.set(image.key, `/img/${finalName}`);
  }

  const versionId = crypto.randomUUID();
  const r2Key = `editions/${job.username}/${job.week_key}/${versionId}.html`;
  const html = renderEdition(manifest, (key) => finalImages.get(key)!);
  await c.env.DISPATCHES.put(r2Key, html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });

  // R2 writes can take time. Refuse to move the public pointer if the lease
  // expired or was reclaimed while artifacts were being finalized.
  if (!await heldJob(c.env.DB, job.id, body.leaseToken)) {
    return c.json({ error: "lease expired before commit" }, 409);
  }

  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO edition_versions
         (id,job_id,user_id,week_key,r2_key,evidence_json,edition_json,image_count,generator_version,model,prompt_version)
         SELECT ?,id,user_id,week_key,?,?,?,?,?,?,?
         FROM generation_jobs
         WHERE id=? AND lease_token=? AND lease_expires_at>=unixepoch() AND status='validating'`
      ).bind(versionId, r2Key, JSON.stringify(manifest.evidence), JSON.stringify(manifest.edition), manifest.images.length, manifest.generatorVersion, manifest.model, manifest.promptVersion, job.id, body.leaseToken),
      c.env.DB.prepare(
        `INSERT INTO dispatches (user_id,week_key,r2_key,generated_at)
         SELECT user_id,week_key,r2_key,unixepoch() FROM edition_versions WHERE id=?
         ON CONFLICT(user_id,week_key) DO UPDATE SET r2_key=excluded.r2_key, generated_at=excluded.generated_at`
      ).bind(versionId),
      c.env.DB.prepare(
        `UPDATE generation_jobs SET status='published',published_at=unixepoch(),updated_at=unixepoch(),
           input_tokens=?,output_tokens=?,token_source=?,image_count=?,wall_time_ms=?,lease_token=NULL,lease_expires_at=NULL
         WHERE id=? AND lease_token=? AND lease_expires_at>=unixepoch()`
      ).bind(usage.inputTokens, usage.outputTokens, usage.tokenSource, usage.imageCount, usage.wallTimeMs, job.id, body.leaseToken),
    ]);
  } catch (error) {
    console.error("atomic publish failed", error);
    return c.json({ error: "atomic publish failed" }, 409);
  }
  const committed = await c.env.DB.prepare(
    "SELECT 1 FROM edition_versions WHERE id=? AND job_id=?"
  ).bind(versionId, job.id).first();
  if (!committed) return c.json({ error: "lease lost during commit" }, 409);

  await deleteR2Prefix(c.env.DISPATCHES, `staging/${job.id}/`);
  return c.json({ status: "published", username: job.username, weekKey: job.week_key, url: `/${job.username}/${job.week_key}`, versionId });
});

async function heldJob(db: D1Database, id: string, leaseToken: string): Promise<ClaimedJob | null> {
  return db.prepare(
    `SELECT j.*,u.username FROM generation_jobs j JOIN users u ON u.id=j.user_id
     WHERE j.id=? AND j.lease_token=? AND j.lease_expires_at>=unixepoch()
       AND j.status IN ('collecting','writing','illustrating','validating')`
  ).bind(id, leaseToken).first<ClaimedJob>();
}

async function updateLeasedJob(db: D1Database, id: string, leaseToken: string, fromStage: string, stage: string, leaseDurationSeconds: number): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE generation_jobs SET status=?,updated_at=unixepoch(),lease_expires_at=unixepoch()+?
     WHERE id=? AND lease_token=? AND lease_expires_at>=unixepoch()
       AND status=?`
  ).bind(stage, leaseDurationSeconds, id, leaseToken, fromStage).run();
  return (result.meta.changes ?? 0) === 1;
}

async function terminalizeSuppressedJob(
  env: Pick<Env, "DB" | "DISPATCHES">,
  id: string,
  leaseToken: string,
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE generation_jobs SET status='permanent_failed',last_error='profile unavailable',
       capacity_started_at=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=unixepoch()
     WHERE id=? AND lease_token=?`
  ).bind(id, leaseToken).run();
  if ((result.meta.changes ?? 0) !== 1) return false;
  await deleteR2Prefix(env.DISPATCHES, `staging/${id}/`);
  return true;
}

function leaseSeconds(env: Env): number {
  const configured = Number(env.RUNNER_LEASE_SECONDS ?? DEFAULT_LEASE_SECONDS);
  return Number.isInteger(configured) && configured >= 2 && configured <= 3600
    ? configured
    : DEFAULT_LEASE_SECONDS;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function isForwardStage(current: string, requested: string): boolean {
  return NEXT_STAGE[current] === requested;
}

export function isArtifactTooLarge(bytes: number): boolean {
  return bytes > MAX_ARTIFACT_BYTES;
}

export function isWebpContentType(value: string | undefined): boolean {
  return value?.split(";")[0]?.trim().toLowerCase() === "image/webp";
}

async function requestJson<T>(c: { req: { json<TValue>(): Promise<TValue> } }): Promise<T | null> {
  try {
    const body = await c.req.json<T>();
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}
