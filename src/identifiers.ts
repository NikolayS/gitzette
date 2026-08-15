const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GITHUB_USERNAME = /^(?!-)[A-Za-z0-9-]{1,39}(?<!-)$/;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function isGitHubUsername(value: string): boolean {
  return GITHUB_USERNAME.test(value);
}
