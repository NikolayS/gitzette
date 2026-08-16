export function failureBackoffSeconds(consecutiveFailures: number, pollSeconds: number): number {
  const failures = Math.max(0, Math.min(consecutiveFailures, 10));
  return Math.min(15 * 60, pollSeconds * 2 ** failures);
}
