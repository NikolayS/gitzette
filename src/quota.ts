import type { Env } from "./index";

export function currentWeekKey(): string {
  // AoE (UTC-12): week doesn't roll until everyone on Earth finishes their Sunday
  const nowAoE = new Date(Date.now() - 12 * 60 * 60 * 1000);
  const thu = new Date(nowAoE);
  thu.setUTCDate(nowAoE.getUTCDate() - ((nowAoE.getUTCDay() + 6) % 7) + 3);
  const y = thu.getUTCFullYear();
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const mon1 = new Date(jan4);
  mon1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const week = Math.floor((thu.getTime() - mon1.getTime()) / (7 * 86400000)) + 1;
  return `${y}-W${String(week).padStart(2, "0")}`;
}

export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// returns { allowed, usedThisWeek, limitPerWeek }
export async function checkUserQuota(
  db: D1Database,
  userId: string,
  limitPerWeek: number
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const week = currentWeekKey();
  const row = await db.prepare(
    `SELECT count FROM generations WHERE user_id = ? AND week_key = ?`
  ).bind(userId, week).first<{ count: number }>();
  const used = row?.count ?? 0;
  return { allowed: used < limitPerWeek, used, limit: limitPerWeek };
}

// returns { allowed, spentUsd, budgetUsd }
export async function checkGlobalBudget(
  db: D1Database,
  budgetUsd: number
): Promise<{ allowed: boolean; spentUsd: number; budgetUsd: number }> {
  const month = currentMonthKey();
  const row = await db.prepare(
    `SELECT usd_cents FROM spend WHERE month_key = ?`
  ).bind(month).first<{ usd_cents: number }>();
  const spentCents = row?.usd_cents ?? 0;
  const spentUsd = spentCents / 100;
  return { allowed: spentUsd < budgetUsd, spentUsd, budgetUsd };
}

// call after successful generation with estimated cost
export async function recordSpend(db: D1Database, costUsd: number): Promise<void> {
  const month = currentMonthKey();
  const cents = Math.round(costUsd * 100);
  await db.prepare(
    `INSERT INTO spend (month_key, usd_cents) VALUES (?, ?)
     ON CONFLICT(month_key) DO UPDATE SET usd_cents = usd_cents + excluded.usd_cents`
  ).bind(month, cents).run();
}

// increment user's weekly generation count
export async function recordGeneration(db: D1Database, userId: string): Promise<void> {
  const week = currentWeekKey();
  await db.prepare(
    `INSERT INTO generations (user_id, week_key, count, last_at) VALUES (?, ?, 1, unixepoch())
     ON CONFLICT(user_id, week_key) DO UPDATE SET count = count + 1, last_at = unixepoch()`
  ).bind(userId, week).run();
}
