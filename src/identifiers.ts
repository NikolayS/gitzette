const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GITHUB_USERNAME = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

export function isUuid(value: string): boolean {
  return UUID_V4.test(value);
}

export function isGitHubUsername(value: string): boolean {
  return normalizeGitHubUsername(value) !== null;
}

export function normalizeGitHubUsername(value: string): string | null {
  return GITHUB_USERNAME.test(value) ? value.toLowerCase() : null;
}
