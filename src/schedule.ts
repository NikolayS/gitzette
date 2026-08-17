import type { Env } from "./index";
import { WEEKLY_PROFILE_USERNAMES } from "./highlighted";
import { previousCompletedIsoWeekKey } from "./week";

export const WEEKLY_GENERATION_CRON = "17 13 * * 1";

export type WeeklyScheduleResult = {
  weekKey: string;
  targets: number;
  queued: number;
  deduplicated: number;
};

export async function enqueueWeeklyProfiles(
  env: Pick<Env, "DB" | "ADMIN_USER_ID">,
  scheduledTime: number,
): Promise<WeeklyScheduleResult> {
  if (!env.ADMIN_USER_ID) throw new Error("weekly generation requires ADMIN_USER_ID");

  const admin = await env.DB.prepare("SELECT id FROM users WHERE id=?")
    .bind(env.ADMIN_USER_ID).first<{ id: string }>();
  if (!admin) throw new Error("weekly generation admin user is missing");

  const placeholders = WEEKLY_PROFILE_USERNAMES.map(() => "?").join(",");
  const profiles = await env.DB.prepare(
    `SELECT id,username FROM users WHERE username COLLATE NOCASE IN (${placeholders})`,
  ).bind(...WEEKLY_PROFILE_USERNAMES).all<{ id: string; username: string }>();
  const byUsername = new Map((profiles.results ?? []).map((row) => [row.username.toLowerCase(), row]));
  const missing = WEEKLY_PROFILE_USERNAMES.filter((username) => !byUsername.has(username.toLowerCase()));
  if (missing.length > 0) throw new Error(`weekly generation profiles are missing: ${missing.join(",")}`);

  const weekKey = previousCompletedIsoWeekKey(new Date(scheduledTime));
  const statements = WEEKLY_PROFILE_USERNAMES.map((username) => {
    const profile = byUsername.get(username.toLowerCase())!;
    return env.DB.prepare(
      `INSERT INTO generation_jobs
       (id,user_id,requested_by,week_key,status,schedule_key)
       VALUES (?,?,?,?,'queued',?)
       ON CONFLICT(schedule_key) WHERE schedule_key IS NOT NULL DO NOTHING`,
    ).bind(crypto.randomUUID(), profile.id, admin.id, weekKey, `${weekKey}:${profile.id}`);
  });
  const results = await env.DB.batch(statements);
  const queued = results.reduce((total, result) => total + (result.meta.changes ?? 0), 0);
  return {
    weekKey,
    targets: WEEKLY_PROFILE_USERNAMES.length,
    queued,
    deduplicated: WEEKLY_PROFILE_USERNAMES.length - queued,
  };
}

export async function runWeeklySchedule(
  controller: ScheduledController,
  env: Env,
): Promise<void> {
  if (controller.cron !== WEEKLY_GENERATION_CRON) {
    throw new Error(`unexpected generation cron: ${controller.cron}`);
  }
  const result = await enqueueWeeklyProfiles(env, controller.scheduledTime);
  console.log(JSON.stringify({ event: "weekly_generation_enqueued", ...result }));
}
