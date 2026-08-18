import { WEEKLY_PROFILE_USERNAMES } from "../src/highlighted";

export function missingWeeklyProfiles(document: unknown): string[] {
  const rows = (document as any)?.[0]?.results;
  if (!Array.isArray(rows)) throw new Error("invalid Wrangler users result");
  const existing = new Set(rows.map((row: unknown) => {
    const username = (row as any)?.username;
    if (typeof username !== "string") throw new Error("invalid Wrangler username row");
    return username.toLowerCase();
  }));
  return WEEKLY_PROFILE_USERNAMES.filter((username) => !existing.has(username.toLowerCase()));
}

if (import.meta.main) {
  const [resultPath] = process.argv.slice(2);
  if (!resultPath) throw new Error("usage: bun scripts/check-weekly-profiles.ts <wrangler-json>");
  const missing = missingWeeklyProfiles(JSON.parse(await Bun.file(resultPath).text()));
  if (missing.length > 0) throw new Error(`production weekly profiles are missing: ${missing.join(",")}`);
  console.log(`Weekly profile preflight OK: ${WEEKLY_PROFILE_USERNAMES.length} retained profiles exist`);
}
