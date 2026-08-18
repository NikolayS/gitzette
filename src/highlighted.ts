// Keep every profile ever selected for automatic publication in this registry.
// Removing a profile from WEEKLY_PROFILE_USERNAMES while retaining it here
// suppresses its existing public routes as well as future automatic work.
export const MANAGED_PROFILE_USERNAMES = [
  "NikolayS",
  "DHH",
  "dcramer",
  "karpathy",
  "levkk",
  "mitchellh",
  "simonw",
  "steipete",
  "torvalds",
  "gitzette-opt-out-test",
] as const;

export const WEEKLY_PROFILE_USERNAMES = [
  "NikolayS",
  "DHH",
  "dcramer",
  "karpathy",
  "levkk",
  "mitchellh",
  "simonw",
  "steipete",
  "torvalds",
] as const;

const HOME_PROFILE_CANDIDATES = [
  "torvalds",
  "steipete",
  "karpathy",
  "DHH",
  "mitchellh",
  "dcramer",
  "simonw",
] as const;

const managedProfiles = normalizedSet(MANAGED_PROFILE_USERNAMES);
const weeklyProfiles = normalizedSet(WEEKLY_PROFILE_USERNAMES);

export const HOME_PROFILE_USERNAMES = HOME_PROFILE_CANDIDATES
  .filter((username) => weeklyProfiles.has(username.toLowerCase()));

export function isManagedProfileSuppressed(username: string): boolean {
  return isProfileSuppressedByPolicy(username, managedProfiles, weeklyProfiles);
}

export function isProfileSuppressedByPolicy(
  username: string,
  managed: ReadonlySet<string>,
  active: ReadonlySet<string>,
): boolean {
  const normalized = username.toLowerCase();
  return managed.has(normalized) && !active.has(normalized);
}

function normalizedSet(usernames: readonly string[]): Set<string> {
  return new Set(usernames.map((username) => username.toLowerCase()));
}
