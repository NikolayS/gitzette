const WEEK_KEY = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const FIRST_GENERATABLE_ISO_WEEK_YEAR = 2026;
export const AOE_LAG_MS = 12 * 60 * 60 * 1000;

export type IsoWeek = {
  key: string;
  year: number;
  week: number;
  monday: Date;
  nextMonday: Date;
  sunday: Date;
};

export function parseIsoWeekKey(value: string): IsoWeek {
  const match = WEEK_KEY.exec(value);
  if (!match) throw new Error("invalid ISO week");
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week > isoWeeksInYear(year)) throw new Error("ISO week does not exist");
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const weekOneMonday = new Date(januaryFourth);
  weekOneMonday.setUTCDate(januaryFourth.getUTCDate() - ((januaryFourth.getUTCDay() + 6) % 7));
  const monday = new Date(weekOneMonday.getTime() + (week - 1) * WEEK_MS);
  const thursday = new Date(monday.getTime() + 3 * 24 * 60 * 60 * 1000);
  if (thursday.getUTCFullYear() !== year) throw new Error("ISO week does not exist");
  const nextMonday = new Date(monday.getTime() + WEEK_MS);
  const sunday = new Date(nextMonday.getTime() - 24 * 60 * 60 * 1000);
  return { key: value, year, week, monday, nextMonday, sunday };
}

function isoWeeksInYear(year: number): 52 | 53 {
  const januaryFirst = new Date(Date.UTC(year, 0, 1));
  const weekday = januaryFirst.getUTCDay() || 7;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return weekday === 4 || (weekday === 3 && leapYear) ? 53 : 52;
}

export function isCompletedIsoWeekKey(value: string, now = new Date()): boolean {
  try {
    const parsed = parseIsoWeekKey(value);
    return parsed.nextMonday.getTime() <= now.getTime() - AOE_LAG_MS;
  } catch {
    return false;
  }
}

export function isGeneratableCompletedIsoWeekKey(value: string, now = new Date()): boolean {
  try {
    const parsed = parseIsoWeekKey(value);
    return parsed.year >= FIRST_GENERATABLE_ISO_WEEK_YEAR
      && parsed.year <= now.getUTCFullYear() + 1
      && parsed.nextMonday.getTime() <= now.getTime() - AOE_LAG_MS;
  } catch {
    return false;
  }
}

export function previousCompletedIsoWeekKey(now = new Date()): string {
  const aoeNow = new Date(now.getTime() - AOE_LAG_MS);
  const dayFromMonday = (aoeNow.getUTCDay() + 6) % 7;
  const currentMonday = new Date(Date.UTC(aoeNow.getUTCFullYear(), aoeNow.getUTCMonth(), aoeNow.getUTCDate() - dayFromMonday));
  const previousThursday = new Date(currentMonday.getTime() - 4 * 24 * 60 * 60 * 1000);
  const year = previousThursday.getUTCFullYear();
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const weekOneMonday = new Date(januaryFourth);
  weekOneMonday.setUTCDate(januaryFourth.getUTCDate() - ((januaryFourth.getUTCDay() + 6) % 7));
  const week = Math.floor((currentMonday.getTime() - WEEK_MS - weekOneMonday.getTime()) / WEEK_MS) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}
