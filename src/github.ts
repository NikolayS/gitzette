export interface RepoActivity {
  nameWithOwner: string;
  url: string;
  commits: number;
}

export interface PullRequest {
  title: string;
  url: string;
  state: "MERGED" | "OPEN" | "CLOSED";
  createdAt: string;
  mergedAt?: string;
  repo: string;
  number: number;
  body?: string;
}

export interface Issue {
  title: string;
  url: string;
  state: "OPEN" | "CLOSED";
  createdAt: string;
  closedAt?: string;
  repo: string;
  number: number;
}

export interface NewRepo {
  nameWithOwner: string;
  url: string;
  description?: string;
  createdAt: string;
}

export interface GitHubData {
  repos: RepoActivity[];
  pullRequests: PullRequest[];
  issues: Issue[];
  newRepos: NewRepo[];
  totalCommits: number;
}

export async function fetchForkPRs(
  repos: string[],
  token: string,
): Promise<PullRequest[]> {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const prs: PullRequest[] = [];
  for (const repo of repos) {
    const [owner, name] = repo.split("/");
    const query = `
      query($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          pullRequests(first: 20, states: [OPEN], orderBy: {field: UPDATED_AT, direction: DESC}) {
            nodes {
              title url number state createdAt updatedAt
              bodyText
              repository { nameWithOwner }
            }
          }
        }
      }`;
    const resp = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables: { owner, name } }),
    });
    const json = await resp.json() as any;
    if (json.errors || !json.data?.repository) continue;
    for (const pr of json.data.repository.pullRequests.nodes) {
      prs.push({
        title: pr.title,
        url: pr.url,
        state: pr.state,
        createdAt: pr.createdAt,
        repo: pr.repository.nameWithOwner,
        number: pr.number,
        body: pr.bodyText?.slice(0, 200),
      });
    }
  }
  return prs;
}

export async function fetchGitHubActivity(
  user: string,
  token: string,
  from: Date,
  to: Date,
  forkRepos: string[] = [],
): Promise<GitHubData> {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const query = `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          commitContributionsByRepository(maxRepositories: 25) {
            repository { nameWithOwner url }
            contributions { totalCount }
          }
          pullRequestContributions(first: 50) {
            nodes {
              pullRequest {
                title url number state createdAt mergedAt
                bodyText
                repository { nameWithOwner }
              }
            }
          }
          issueContributions(first: 50) {
            nodes {
              issue {
                title url number state createdAt closedAt
                repository { nameWithOwner }
              }
            }
          }
        }
        repositories(first: 20, orderBy: {field: CREATED_AT, direction: DESC}) {
          nodes { nameWithOwner url description createdAt }
        }
      }
    }
  `;

  const resp = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables: { login: user, from: from.toISOString(), to: to.toISOString() } }),
  });

  const json = await resp.json() as any;
  if (json.errors) throw new Error(json.errors[0].message);

  const contrib = json.data.user.contributionsCollection;

  const repos: RepoActivity[] = contrib.commitContributionsByRepository.map((r: any) => ({
    nameWithOwner: r.repository.nameWithOwner,
    url: r.repository.url,
    commits: r.contributions.totalCount,
  }));

  const totalCommits = repos.reduce((sum, r) => sum + r.commits, 0);

  const pullRequests: PullRequest[] = contrib.pullRequestContributions.nodes.map((n: any) => ({
    title: n.pullRequest.title,
    url: n.pullRequest.url,
    state: n.pullRequest.state,
    createdAt: n.pullRequest.createdAt,
    mergedAt: n.pullRequest.mergedAt,
    repo: n.pullRequest.repository.nameWithOwner,
    number: n.pullRequest.number,
    body: n.pullRequest.bodyText?.slice(0, 200),
  }));

  const issues: Issue[] = contrib.issueContributions.nodes.map((n: any) => ({
    title: n.issue.title,
    url: n.issue.url,
    state: n.issue.state,
    createdAt: n.issue.createdAt,
    closedAt: n.issue.closedAt,
    repo: n.issue.repository.nameWithOwner,
    number: n.issue.number,
  }));

  // New repos created in the date range
  const newRepos: NewRepo[] = json.data.user.repositories.nodes
    .filter((r: any) => {
      const created = new Date(r.createdAt);
      return created >= from && created <= to;
    })
    .map((r: any) => ({
      nameWithOwner: r.nameWithOwner,
      url: `https://github.com/${r.nameWithOwner}`,
      description: r.description,
      createdAt: r.createdAt,
    }));

  // Add fork WIP PRs
  if (forkRepos.length > 0) {
    const forkPRs = await fetchForkPRs(forkRepos, token);
    pullRequests.push(...forkPRs);
  }

  return { repos, pullRequests, issues, newRepos, totalCommits };
}
