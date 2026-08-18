import { Hono } from "hono";
import { getUser } from "./auth";
import type { Env } from "./index";
import { isGitHubUsername } from "./identifiers";
import { isManagedProfileSuppressed } from "./highlighted";
import { deleteR2Prefix } from "./artifacts";
import { isCompletedIsoWeekKey, isGeneratableCompletedIsoWeekKey, previousCompletedIsoWeekKey } from "./week";

export const LIVE_STATUSES = ["queued", "collecting", "writing", "illustrating", "validating", "retryable_failed"] as const;
export const TERMINAL_STATUSES = ["published", "permanent_failed"] as const;
export const ALL_STATUSES = [...LIVE_STATUSES, ...TERMINAL_STATUSES] as const;
export const MAX_GENERATE_BODY_BYTES = 2048;
export const SCHEDULED_AGE_OUT_ERROR = "scheduled generation aged out before provider start";
const DEFAULT_MAX_QUEUE_AGE_SECONDS = 6 * 60 * 60;

export const GENERATION_REQUEST_INSERT_SQL = `INSERT INTO generation_jobs
  (id,user_id,requested_by,week_key,status)
 SELECT ?,?,?,?,'queued'
 WHERE ? OR (
   SELECT COUNT(*) FROM generation_jobs
   WHERE requested_by=? AND created_at>=unixepoch('now','-7 days')
 ) < ?`;

type JobRow = {
  id: string;
  user_id: string;
  requested_by: string;
  username: string;
  week_key: string;
  status: string;
  attempt: number;
  lease_expires_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
  published_at: number | null;
};

export const queueRoutes = new Hono<{ Bindings: Env }>();

function defaultCompletedWeek(now = new Date()): string {
  return previousCompletedIsoWeekKey(now);
}

function publicJob(row: JobRow) {
  return {
    id: row.id,
    username: row.username,
    weekKey: row.week_key,
    status: row.status,
    attempt: row.attempt,
    error: publicError(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  };
}

queueRoutes.post("/generate", async (c) => {
  const requester = await getUser(c);
  if (!requester) return c.json({ error: "not authenticated" }, 401);

  const declaredLength = Number(c.req.header("content-length") || 0);
  if (isGenerateBodyTooLarge(declaredLength)) return c.json({ error: "request body too large" }, 413);

  let body: { weekKey?: unknown; forUsername?: unknown } = {};
  const bytes = await c.req.arrayBuffer();
  if (isGenerateBodyTooLarge(bytes.byteLength)) return c.json({ error: "request body too large" }, 413);
  if (bytes.byteLength > 0) {
    try { body = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { return c.json({ error: "invalid request body" }, 400); }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "invalid request body" }, 400);
  const unknownFields = Object.keys(body).filter((key) => key !== "weekKey" && key !== "forUsername");
  if (unknownFields.length > 0) return c.json({ error: `unknown request field: ${unknownFields[0]}` }, 400);
  const weekKey = body.weekKey === undefined ? defaultCompletedWeek() : body.weekKey;
  if (typeof weekKey !== "string" || !isGeneratableCompletedIsoWeekKey(weekKey)) {
    return c.json({ error: "invalid or incomplete weekKey" }, 400);
  }

  let target = requester;
  if (body.forUsername !== undefined) {
    if (!isAdmin(requester.id, c.env.ADMIN_USER_ID)) return c.json({ error: "forbidden" }, 403);
    if (typeof body.forUsername !== "string" || !isGitHubUsername(body.forUsername)) {
      return c.json({ error: "invalid forUsername" }, 400);
    }
    const existing = await c.env.DB.prepare("SELECT id, username, avatar_url FROM users WHERE username = ? COLLATE NOCASE")
      .bind(body.forUsername).first<typeof requester>();
    if (!existing) return c.json({ error: "target user must exist before enqueue" }, 404);
    target = existing;
  }
  if (isManagedProfileSuppressed(target.username)) {
    return c.json({ error: "profile unavailable" }, 410);
  }

  const expiredJobIds = await expireStaleTargetJob(c.env.DB, maxQueueAgeSeconds(c.env), target.id, weekKey);
  await Promise.all(expiredJobIds.map((id) => deleteR2Prefix(c.env.DISPATCHES, `staging/${id}/`)));

  const live = await c.env.DB.prepare(
    `SELECT j.*, u.username FROM generation_jobs j JOIN users u ON u.id=j.user_id
     WHERE j.user_id=? AND j.week_key=? AND j.status IN (${LIVE_STATUSES.map(() => "?").join(",")}) LIMIT 1`
  ).bind(target.id, weekKey, ...LIVE_STATUSES).first<JobRow>();
  if (live) return c.json({ status: "accepted", job: publicJob(live), deduplicated: true }, 202);

  const id = crypto.randomUUID();
  const requestLimit = Math.max(1, Number.parseInt(c.env.ROLLING_7D_USER_GENERATION_LIMIT || "3", 10) || 3);
  try {
    const inserted = await c.env.DB.prepare(GENERATION_REQUEST_INSERT_SQL)
      .bind(id, target.id, requester.id, weekKey, isAdmin(requester.id, c.env.ADMIN_USER_ID) ? 1 : 0, requester.id, requestLimit).run();
    if ((inserted.meta.changes ?? 0) !== 1) {
      return c.json({ error: "generation request limit reached", weeklyUserLimit: requestLimit }, 429);
    }
  } catch (error) {
    const raced = await c.env.DB.prepare(
      `SELECT j.*, u.username FROM generation_jobs j JOIN users u ON u.id=j.user_id
       WHERE j.user_id=? AND j.week_key=? AND j.status IN (${LIVE_STATUSES.map(() => "?").join(",")}) LIMIT 1`
    ).bind(target.id, weekKey, ...LIVE_STATUSES).first<JobRow>();
    if (raced) return c.json({ status: "accepted", job: publicJob(raced), deduplicated: true }, 202);
    throw error;
  }
  const row = await getJob(c.env.DB, id);
  return c.json({ status: "accepted", job: publicJob(row!), deduplicated: false }, 202);
});

queueRoutes.get("/generate/jobs/:id", async (c) => {
  const requester = await getUser(c);
  if (!requester) return c.json({ error: "not authenticated" }, 401);
  const row = await getJob(c.env.DB, c.req.param("id"));
  if (!row) return c.json({ error: "not found" }, 404);
  if (row.requested_by !== requester.id && row.user_id !== requester.id && !isAdmin(requester.id, c.env.ADMIN_USER_ID)) {
    return c.json({ error: "forbidden" }, 403);
  }
  return c.json({ job: publicJob(stalePublicRow(row, maxQueueAgeSeconds(c.env))) });
});

queueRoutes.get("/generate/status", async (c) => {
  const requester = await getUser(c);
  if (!requester) return c.json({ error: "not authenticated" }, 401);
  const weekKey = c.req.query("weekKey");
  if (weekKey !== undefined && !isCompletedIsoWeekKey(weekKey)) {
    return c.json({ error: "invalid or incomplete weekKey" }, 400);
  }
  const statement = c.env.DB.prepare(
    `SELECT j.*, u.username FROM generation_jobs j JOIN users u ON u.id=j.user_id
     WHERE j.user_id=?${weekKey === undefined ? "" : " AND j.week_key=?"}
     ORDER BY j.created_at DESC, j.rowid DESC LIMIT 1`
  );
  const row = weekKey === undefined
    ? await statement.bind(requester.id).first<JobRow>()
    : await statement.bind(requester.id, weekKey).first<JobRow>();
  if (!row) return c.json({ status: "none" });
  const effectiveRow = stalePublicRow(row, maxQueueAgeSeconds(c.env));
  const job = publicJob(effectiveRow);
  // Keep the existing browser contract while exposing the precise durable
  // stage for new clients.
  if (effectiveRow.status === "published") return c.json({ job, status: "ready", stage: effectiveRow.status, week_key: effectiveRow.week_key });
  if (effectiveRow.status === "permanent_failed") return c.json({ job, status: "failed", stage: effectiveRow.status, error: job.error });
  return c.json({ job, status: "generating", stage: effectiveRow.status, age: Math.max(0, Math.floor(Date.now() / 1000) - effectiveRow.created_at) });
});

async function getJob(db: D1Database, id: string): Promise<JobRow | null> {
  return db.prepare(
    "SELECT j.*, u.username FROM generation_jobs j JOIN users u ON u.id=j.user_id WHERE j.id=?"
  ).bind(id).first<JobRow>();
}

export async function expireStaleJobs(db: D1Database, maxAgeSeconds: number): Promise<string[]> {
  const expired = await db.prepare(
    `UPDATE generation_jobs
     SET status='permanent_failed',
         schedule_key=CASE WHEN capacity_started_at IS NULL THEN NULL ELSE schedule_key END,
         last_error=CASE
           WHEN schedule_key IS NOT NULL AND capacity_started_at IS NULL THEN ?
           ELSE 'generation runner unavailable; please retry'
         END,
         updated_at=unixepoch()
     WHERE (
       status IN ('queued','retryable_failed') OR
       (status IN ('collecting','writing','illustrating','validating') AND lease_expires_at < unixepoch())
     ) AND created_at < unixepoch()-?
     RETURNING id`
  ).bind(SCHEDULED_AGE_OUT_ERROR, maxAgeSeconds).all<{ id: string }>();
  return (expired.results ?? []).map((job) => job.id);
}

async function expireStaleTargetJob(
  db: D1Database,
  maxAgeSeconds: number,
  userId: string,
  weekKey: string,
): Promise<string[]> {
  const expired = await db.prepare(
    `UPDATE generation_jobs
     SET status='permanent_failed',
         schedule_key=CASE WHEN capacity_started_at IS NULL THEN NULL ELSE schedule_key END,
         last_error=CASE
           WHEN schedule_key IS NOT NULL AND capacity_started_at IS NULL THEN ?
           ELSE 'generation runner unavailable; please retry'
         END,
         updated_at=unixepoch()
     WHERE user_id=? AND week_key=? AND (
       status IN ('queued','retryable_failed') OR
       (status IN ('collecting','writing','illustrating','validating') AND lease_expires_at < unixepoch())
     ) AND created_at < unixepoch()-?
     RETURNING id`
  ).bind(SCHEDULED_AGE_OUT_ERROR, userId, weekKey, maxAgeSeconds).all<{ id: string }>();
  return (expired.results ?? []).map((job) => job.id);
}

export function isAdmin(userId: string, adminUserId: string | undefined): boolean {
  return Boolean(adminUserId) && userId === adminUserId;
}

function stalePublicRow(row: JobRow, maxAgeSeconds: number, now = Math.floor(Date.now() / 1000)): JobRow {
  const staleQueued = (row.status === "queued" || row.status === "retryable_failed") && row.created_at < now - maxAgeSeconds;
  const staleLeased = ["collecting", "writing", "illustrating", "validating"].includes(row.status)
    && row.created_at < now - maxAgeSeconds && (row.lease_expires_at ?? 0) < now;
  return staleQueued || staleLeased
    ? { ...row, status: "permanent_failed", last_error: "generation runner unavailable" }
    : row;
}

function publicError(row: JobRow): string | null {
  if (row.status !== "permanent_failed") return null;
  return publicFailureCode(row.last_error);
}

export function publicFailureCode(internalMessage: string | null): string {
  const message = (internalMessage || "").toLowerCase();
  if (message.includes("collect") || message.includes("evidence") || message.includes("github")) return "evidence_incomplete";
  if (message.includes("valid") || message.includes("illustr") || message.includes("editor")) return "validation_failed";
  return "provider_unavailable";
}

export function maxQueueAgeSeconds(env: Pick<Env, "MAX_QUEUE_AGE_SECONDS">): number {
  return positiveInteger(env.MAX_QUEUE_AGE_SECONDS, DEFAULT_MAX_QUEUE_AGE_SECONDS);
}

export function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function isGenerateBodyTooLarge(bytes: number): boolean {
  return bytes > MAX_GENERATE_BODY_BYTES;
}
