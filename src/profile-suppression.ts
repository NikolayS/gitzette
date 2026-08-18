import { isManagedProfileSuppressed } from "./highlighted";

export type ProfilePublicationState = {
  username: string;
  suppressed?: number | boolean | null;
};

export function isProfileSuppressed(profile: ProfilePublicationState): boolean {
  return isManagedProfileSuppressed(profile.username) || Boolean(profile.suppressed);
}

export async function isRuntimeProfileSuppressed(
  db: D1Database,
  username: string,
): Promise<boolean> {
  const row = await db.prepare(
    "SELECT 1 FROM profile_suppressions WHERE username=? COLLATE NOCASE",
  ).bind(username).first();
  return Boolean(row);
}
