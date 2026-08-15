import { Hono } from "hono";
import { getUser } from "./auth";
import type { Env } from "./index";
import { isGitHubUsername } from "./identifiers";
import { isCompletedIsoWeekKey, previousCompletedIsoWeekKey } from "./week";

const LIVE_STATUSES = ["queued", "collecting", "writing", "illustrating", "validating", "retryable_failed"];
const MAX_GENERATE_BODY_BYTES = 2048;
const DEFAULT_GLOBAL_WEEKLY_LIMIT = 100;
const DEFAULT_MAX_QUEUE_AGE_SECONDS = 6 * 60 * 60;

type JobRow = {
  id: string;
  user_id: string;
  requested_by: string;
  username: string;
  week_key: string;
  status: string;
  attempt: number;
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
    error: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  };
}

queueRoutes.post("/generate", async (c) => {
  const requester = await getUser(c);
  if (!requester) return c.json({ error: "not authenticated" }, 401);

  const declaredLength = Number(c.req.header("content-length") || 0);
  if (declaredLength > MAX_GENERATE_BODY_BYTES) return c.json({ error: "request body too large" }, 413);

  let body: { weekKey?: unknown; forUsername?: unknown } = {};
  try { body = await c.req.json(); } catch { /* empty body uses defaults */ }
  if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "invalid request body" }, 400);
  const unknownFields = Object.keys(body).filter((key) => key !== "weekKey" && key !== "forUsername");
  if (unknownFields.length > 0) return c.json({ error: `unknown request field: ${unknownFields[0]}` }, 400);
  const weekKey = body.weekKey === undefined ? defaultCompletedWeek() : body.weekKey;
  if (typeof weekKey !== "string" || !isCompletedIsoWeekKey(weekKey)) return c.json({ error: "invalid or incomplete weekKey" }, 400);

  let target = requester;
  if (body.forUsername !== undefined) {
    if (requester.username !== "NikolayS") return c.json({ error: "forbidden" }, 403);
    if (typeof body.forUsername !== "string" || !isGitHubUsername(body.forUsername)) {
      return c.json({ error: "invalid forUsername" }, 400);
    }
    const existing = await c.env.DB.prepare("SELECT id, username, avatar_url FROM users WHERE username = ? COLLATE NOCASE")
      .bind(body.forUsername).first<typeof requester>();
    if (!existing) return c.json({ error: "target user must exist before enqueue" }, 404);
    target = existing;
  }

  await expireStaleJobs(c.env.DB, maxQueueAgeSeconds(c.env));

  const live = await c.env.DB.prepare(
    `SELECT j.*, u.username FROM generation_jobs j JOIN users u ON u.id=j.user_id
     WHERE j.user_id=? AND j.week_key=? AND j.status IN (${LIVE_STATUSES.map(() => "?").join(",")}) LIMIT 1`
  ).bind(target.id, weekKey, ...LIVE_STATUSES).first<JobRow>();
  if (live) return c.json({ status: "accepted", job: publicJob(live), deduplicated: true }, 202);

  const id = crypto.randomUUID();
  const requestLimit = Math.max(1, Number.parseInt(c.env.WEEKLY_REGEN_LIMIT || "3", 10) || 3);
  const globalLimit = positiveInteger(c.env.GLOBAL_WEEKLY_GENERATION_LIMIT, DEFAULT_GLOBAL_WEEKLY_LIMIT);
  try {
    const inserted = await c.env.DB.prepare(
      `INSERT INTO generation_jobs (id,user_id,requested_by,week_key,status)
       SELECT ?,?,?,?,'queued'
       WHERE (
         ? OR (
           SELECT COUNT(*) FROM generation_jobs
           WHERE requested_by=? AND created_at>=unixepoch('now','-7 days')
         ) < ?
       ) AND (
         SELECT COUNT(*) FROM generation_jobs
         WHERE created_at>=unixepoch('now','-7 days')
       ) < ?`
    ).bind(id, target.id, requester.id, weekKey, requester.username === "NikolayS" ? 1 : 0, requester.id, requestLimit, globalLimit).run();
    if ((inserted.meta.changes ?? 0) !== 1) {
      return c.json({ error: "generation capacity reached", weeklyUserLimit: requestLimit, weeklyGlobalLimit: globalLimit }, 429);
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
  if (row.requested_by !== requester.id && row.user_id !== requester.id && requester.username !== "NikolayS") {
    return c.json({ error: "forbidden" }, 403);
  }
  return c.json({ job: publicJob(row) });
});

queueRoutes.get("/generate/status", async (c) => {
  const requester = await getUser(c);
  if (!requester) return c.json({ error: "not authenticated" }, 401);
  await expireStaleJobs(c.env.DB, maxQueueAgeSeconds(c.env));
  const row = await c.env.DB.prepare(
    `SELECT j.*, u.username FROM generation_jobs j JOIN users u ON u.id=j.user_id
     WHERE j.user_id=? ORDER BY j.created_at DESC, j.rowid DESC LIMIT 1`
  ).bind(requester.id).first<JobRow>();
  if (!row) return c.json({ status: "none" });
  const job = publicJob(row);
  // Keep the existing browser contract while exposing the precise durable
  // stage for new clients.
  if (row.status === "published") return c.json({ job, status: "ready", stage: row.status, week_key: row.week_key });
  if (row.status === "permanent_failed") return c.json({ job, status: "failed", stage: row.status, error: row.last_error });
  return c.json({ job, status: "generating", stage: row.status, age: Math.max(0, Math.floor(Date.now() / 1000) - row.created_at) });
});

async function getJob(db: D1Database, id: string): Promise<JobRow | null> {
  return db.prepare(
    "SELECT j.*, u.username FROM generation_jobs j JOIN users u ON u.id=j.user_id WHERE j.id=?"
  ).bind(id).first<JobRow>();
}

async function expireStaleJobs(db: D1Database, maxAgeSeconds: number): Promise<void> {
  await db.prepare(
    `UPDATE generation_jobs
     SET status='permanent_failed', last_error='generation runner unavailable; please retry', updated_at=unixepoch()
     WHERE status IN ('queued','retryable_failed') AND created_at < unixepoch()-?`
  ).bind(maxAgeSeconds).run();
}

function maxQueueAgeSeconds(env: Env): number {
  return positiveInteger(env.MAX_QUEUE_AGE_SECONDS, DEFAULT_MAX_QUEUE_AGE_SECONDS);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
