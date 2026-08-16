export function failureBackoffSeconds(consecutiveFailures: number, pollSeconds: number): number {
  if (consecutiveFailures <= 0) return pollSeconds;
  return Math.min(15 * 60, pollSeconds * 2 ** Math.min(consecutiveFailures, 10));
}
