import type { Env } from "./index";
import { WEEKLY_PROFILE_USERNAMES } from "./highlighted";
import { expireStaleJobs, LIVE_STATUSES, maxQueueAgeSeconds } from "./queue";
import { parseIsoWeekKey, previousCompletedIsoWeekKey } from "./week";
import { deleteR2Prefix } from "./artifacts";
import { isProfileSuppressed } from "./profile-suppression";

export const JOB_EXPIRY_CRON = "7 * * * *";
export const WEEKLY_GENERATION_CRONS = ["17 13 * * 1", "17 20 * * 1"] as const;
export const WEEKLY_GENERATION_CRON = WEEKLY_GENERATION_CRONS[0];
export const WEEKLY_GENERATION_RETRY_CRON = WEEKLY_GENERATION_CRONS[1];
const weeklyGenerationCrons = new Set<string>(WEEKLY_GENERATION_CRONS);

export function postRetryUnfulfilledWeekKey(now: Date, maxAgeSeconds: number): string | null {
  if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds < 1) throw new Error("invalid schedule recovery age");
  const weekKey = previousCompletedIsoWeekKey(now);
  const [minute, hour] = WEEKLY_GENERATION_RETRY_CRON.split(" ").map(Number);
  const nextMonday = parseIsoWeekKey(weekKey).nextMonday.getTime();
  const alertAt = nextMonday + (hour * 60 + minute) * 60_000 + maxAgeSeconds * 1000;
  return now.getTime() >= alertAt ? weekKey : null;
}

export type WeeklyScheduleResult = {
  weekKey: string;
  targets: number;
  queued: number;
  deduplicated: number;
};

export async function enqueueWeeklyProfiles(
  env: Pick<Env, "DB" | "DISPATCHES" | "ADMIN_USER_ID" | "MAX_QUEUE_AGE_SECONDS">,
  scheduledTime: number,
): Promise<WeeklyScheduleResult> {
  return enqueueWeeklyProfilesAfterSweep(env, scheduledTime, false);
}

async function enqueueWeeklyProfilesAfterSweep(
  env: Pick<Env, "DB" | "DISPATCHES" | "ADMIN_USER_ID" | "MAX_QUEUE_AGE_SECONDS">,
  scheduledTime: number,
  staleSweepComplete: boolean,
): Promise<WeeklyScheduleResult> {
  if (!env.ADMIN_USER_ID) throw new Error("weekly generation requires ADMIN_USER_ID");

  const admin = await env.DB.prepare("SELECT id FROM users WHERE id=?")
    .bind(env.ADMIN_USER_ID).first<{ id: string }>();
  if (!admin) throw new Error("weekly generation admin user is missing");

  const placeholders = WEEKLY_PROFILE_USERNAMES.map(() => "?").join(",");
  const profiles = await env.DB.prepare(
    `SELECT id,username,
       EXISTS(SELECT 1 FROM profile_suppressions ps WHERE ps.username=users.username COLLATE NOCASE) AS suppressed
     FROM users WHERE username COLLATE NOCASE IN (${placeholders})`,
  ).bind(...WEEKLY_PROFILE_USERNAMES).all<{ id: string; username: string; suppressed: number }>();
  const byUsername = new Map((profiles.results ?? []).map((row) => [row.username.toLowerCase(), row]));
  const missing = WEEKLY_PROFILE_USERNAMES.filter((username) => !byUsername.has(username.toLowerCase()));
  if (missing.length > 0) {
    console.error(JSON.stringify({ event: "weekly_generation_profiles_missing", missing }));
    throw new Error(`weekly generation profiles are missing: ${missing.join(",")}`);
  }
  const eligibleUsernames = WEEKLY_PROFILE_USERNAMES.filter((username) =>
    !isProfileSuppressed(byUsername.get(username.toLowerCase())!),
  );

  if (!staleSweepComplete) await expireStaleArtifacts(env);

  const weekKey = previousCompletedIsoWeekKey(new Date(scheduledTime));
  const statements = eligibleUsernames.map((username) => {
    const profile = byUsername.get(username.toLowerCase())!;
    return env.DB.prepare(
      `INSERT INTO generation_jobs
       (id,user_id,requested_by,week_key,status,schedule_key)
       SELECT ?,?,?,?,'queued',?
       WHERE NOT EXISTS (
         SELECT 1 FROM profile_suppressions WHERE username=? COLLATE NOCASE
       ) AND NOT EXISTS (
         SELECT 1 FROM generation_jobs
         WHERE user_id=? AND week_key=? AND status IN (${LIVE_STATUSES.map(() => "?").join(",")})
       )
       ON CONFLICT(schedule_key) WHERE schedule_key IS NOT NULL DO NOTHING`,
    ).bind(
      crypto.randomUUID(),
      profile.id,
      admin.id,
      weekKey,
      `${weekKey}:${profile.id}`,
      username,
      profile.id,
      weekKey,
      ...LIVE_STATUSES,
    );
  });
  const results = await env.DB.batch(statements);
  const queued = results.reduce((total, result) => total + (result.meta.changes ?? 0), 0);
  return {
    weekKey,
    targets: eligibleUsernames.length,
    queued,
    deduplicated: eligibleUsernames.length - queued,
  };
}

export async function runWeeklySchedule(
  controller: ScheduledController,
  env: Env,
): Promise<void> {
  const cleanupEnabled = env.CLEANUP_SWEEP_ENABLED === "true";
  if (controller.cron === JOB_EXPIRY_CRON) {
    if (!cleanupEnabled) {
      console.log(JSON.stringify({ event: "generation_cleanup_disabled" }));
      return;
    }
    await expireStaleArtifacts(env);
    console.log(JSON.stringify({ event: "generation_jobs_expired" }));
    return;
  }
  if (!weeklyGenerationCrons.has(controller.cron)) {
    throw new Error(`unexpected generation cron: ${controller.cron}`);
  }
  // Cleanup remains independent of weekly enqueue after explicit activation.
  // Weekly generation itself fails closed unless that prerequisite is active.
  if (cleanupEnabled) await expireStaleArtifacts(env);
  if (env.WEEKLY_GENERATION_ENABLED !== "true") {
    console.log(JSON.stringify({ event: "weekly_generation_disabled" }));
    return;
  }
  if (!cleanupEnabled) throw new Error("weekly generation requires CLEANUP_SWEEP_ENABLED=true");
  const result = await enqueueWeeklyProfilesAfterSweep(env, controller.scheduledTime, true);
  console.log(JSON.stringify({ event: "weekly_generation_enqueued", ...result }));
}

async function expireStaleArtifacts(env: Pick<Env, "DB" | "DISPATCHES" | "MAX_QUEUE_AGE_SECONDS">): Promise<void> {
  const expiredJobIds = await expireStaleJobs(env.DB, maxQueueAgeSeconds(env));
  for (const id of expiredJobIds) {
    try {
      await deleteR2Prefix(env.DISPATCHES, `staging/${id}/`);
    } catch (error) {
      console.error(JSON.stringify({
        event: "stale_artifact_cleanup_failed",
        jobId: id,
        error: error instanceof Error ? error.message.slice(0, 500) : "unknown cleanup error",
      }));
    }
  }
}
