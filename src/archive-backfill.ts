import type { Env } from './index';
import { isUsernameBlockedByManagedRegistry } from './highlighted';
import { maxQueueAgeSeconds } from './queue';

// Original August revival scope: eight profiles, completed ISO weeks W10–W32.
// This is fixed operator work, not a website-controlled generation interface.
export const ARCHIVE_PROFILES = ['nikolays','torvalds','steipete','karpathy','dhh','mitchellh','dcramer','simonw'] as const;
const repairs = new Set(['nikolays:2026-W10','torvalds:2026-W13','torvalds:2026-W16','steipete:2026-W14','dhh:2026-W12','dhh:2026-W16','dcramer:2026-W12']);
export const ARCHIVE_TARGETS = Array.from({length:23},(_,offset)=>offset+10).flatMap(week=>
  ARCHIVE_PROFILES.map((username,index)=>({
    id:`b4cf1100-2026-4000-8000-${(week*100+index).toString(16).padStart(12,'0')}`,
    username, weekKey:`2026-W${String(week).padStart(2,'0')}`, position:index,
    repair:repairs.has(`${username}:2026-W${String(week).padStart(2,'0')}`),
  })),
);

export function archiveEnqueueSql(): string | null {
  const eligible=ARCHIVE_TARGETS.filter(t=>!isUsernameBlockedByManagedRegistry(t.username));
  if (!eligible.length) return null;
  // Only fixed source constants enter this SQL; runtime values use bindings.
  const values=eligible.map(t=>`('${t.id}','${t.username}','${t.weekKey}',${t.position},${Number(t.repair)})`).join(',');
  return `WITH targets(id,username,week_key,position,repair) AS (VALUES ${values})
INSERT INTO generation_jobs(id,user_id,requested_by,week_key,status)
SELECT t.id,u.id,owner.id,t.week_key,'queued'
FROM targets t JOIN users u ON u.username=t.username COLLATE NOCASE
JOIN users owner ON owner.id=? AND owner.username='nikolays' COLLATE NOCASE
WHERE NOT EXISTS (SELECT 1 FROM profile_suppressions p WHERE p.username=u.username COLLATE NOCASE OR p.username=owner.username COLLATE NOCASE)
AND NOT EXISTS (SELECT 1 FROM generation_jobs outstanding WHERE outstanding.id LIKE 'b4cf1100-2026-4000-8000-%' AND outstanding.status IN ('queued','collecting','writing','illustrating','validating','retryable_failed'))
AND (t.repair=1 OR NOT EXISTS (SELECT 1 FROM dispatches d WHERE d.user_id=u.id AND d.week_key=t.week_key AND d.r2_key IS NOT NULL))
AND NOT EXISTS (SELECT 1 FROM generation_jobs j WHERE j.id=t.id OR (j.user_id=u.id AND j.week_key=t.week_key AND j.status IN ('queued','collecting','writing','illustrating','validating','retryable_failed','published')))
AND (SELECT COUNT(*) FROM generation_jobs j WHERE j.capacity_started_at>=? OR (j.capacity_started_at IS NULL AND j.created_at>=? AND j.status IN ('queued','collecting','writing','illustrating','validating','retryable_failed'))) < ?
ORDER BY t.week_key DESC,t.position LIMIT 1
ON CONFLICT(id) DO NOTHING`;
}

export async function enqueueIdleArchiveJob(env: Env, now: number, globalLimit: number): Promise<void> {
  if (env.ARCHIVE_BACKFILL_ENABLED !== 'true') return;
  if (env.ADMIN_USER_ID !== '1345402') throw new Error('archive backfill requires the authorized owner');
  const sql=archiveEnqueueSql();
  if (!sql) return;
  // Leave ten slots for the nine weekly profiles and normal interactive work.
  // The ordinary claim path still enforces the full unchanged global limit.
  await env.DB.prepare(sql).bind(env.ADMIN_USER_ID,now-7*24*60*60,now-maxQueueAgeSeconds(env),Math.max(0,globalLimit-10)).run();
}
