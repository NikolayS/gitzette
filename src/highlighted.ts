export const MANAGED_PROFILE_USERNAMES = [
  "nikolays",
  "dhh",
  "dcramer",
  "karpathy",
  "levkk",
  "mitchellh",
  "simonw",
  "steipete",
  "torvalds",
] as const;

export const WEEKLY_PROFILE_USERNAMES = [
  "nikolays",
  "dhh",
  "dcramer",
  "karpathy",
  "levkk",
  "mitchellh",
  "simonw",
  "steipete",
  "torvalds",
] as const;

// Tombstones are independent of the active and managed registries. Removing a
// retired profile from either registry must never restore its public routes.
export const SUPPRESSED_PROFILE_USERNAMES = [
  "gitzette-opt-out-test",
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
const suppressedProfiles = normalizedSet(SUPPRESSED_PROFILE_USERNAMES);

export const HOME_PROFILE_USERNAMES = HOME_PROFILE_CANDIDATES
  .filter((username) => weeklyProfiles.has(username.toLowerCase()));

export function isUsernameBlockedByManagedRegistry(username: string): boolean {
  return isUsernameBlockedByRegistryPolicy(username, managedProfiles, weeklyProfiles, suppressedProfiles);
}

export function isUsernameBlockedByRegistryPolicy(
  username: string,
  managed: ReadonlySet<string>,
  active: ReadonlySet<string>,
  suppressed: ReadonlySet<string> = new Set(),
): boolean {
  const normalized = username.toLowerCase();
  return suppressed.has(normalized) || (managed.has(normalized) && !active.has(normalized));
}

function normalizedSet(usernames: readonly string[]): Set<string> {
  return new Set(usernames.map((username) => username.toLowerCase()));
}
