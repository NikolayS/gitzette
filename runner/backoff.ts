export const DEFAULT_POLL_SECONDS = 10;

export function failureBackoffSeconds(consecutiveFailures: number, pollSeconds: number): number {
  const base = Number.isFinite(pollSeconds) && pollSeconds > 0 ? pollSeconds : DEFAULT_POLL_SECONDS;
  const failures = Number.isFinite(consecutiveFailures)
    ? Math.max(0, Math.min(Math.trunc(consecutiveFailures), 10))
    : 10;
  return Math.min(15 * 60, base * 2 ** failures);
}
