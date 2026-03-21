import type { Config } from "./config.ts";
import type { GitHubData } from "./github.ts";


export interface GeneratedContent {
  heroHeadline: string;
  heroDeck: string;
  heroBody: string;
  sectionStories: Array<{
    tag: string;
    headline: string;
    body: string;
  }>;
  pullQuote: string;
  editionBarItems: string[];
}

function buildPrompt(user: string, data: GitHubData, from: Date, to: Date, socialNotes?: string): string {
  const fmt = (d: string) => new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const weekStr = `${from.toLocaleDateString("en-US", { month: "long", day: "numeric" })} – ${to.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;

  const prsByRepo: Record<string, typeof data.pullRequests> = {};
  for (const pr of data.pullRequests) {
    if (!prsByRepo[pr.repo]) prsByRepo[pr.repo] = [];
    prsByRepo[pr.repo].push(pr);
  }

  const prSummary = Object.entries(prsByRepo).map(([repo, prs]) => {
    const merged = prs.filter(p => p.state === "MERGED");
    const open = prs.filter(p => p.state === "OPEN");
    return `${repo}: ${merged.length} merged, ${open.length} open\n` +
      prs.map(p => `  [${p.state}] ${fmt(p.createdAt)} ${p.title} ${p.url}`).join("\n");
  }).join("\n\n");

  const commitSummary = data.repos
    .sort((a, b) => b.commits - a.commits)
    .map(r => `  ${r.nameWithOwner}: ${r.commits} commits`)
    .join("\n");

  const newRepoSummary = data.newRepos.map(r =>
    `  ${r.nameWithOwner} (${fmt(r.createdAt)}): ${r.description || "no description"}`
  ).join("\n");

  const issueSummary = data.issues
    .filter(i => i.state === "CLOSED")
    .map(i => `  [CLOSED ${fmt(i.closedAt!)}] ${i.title} — ${i.repo}`)
    .join("\n");

  const socialSection = socialNotes
    ? `\nSOCIAL ACTIVITY (LinkedIn/Twitter/X):\n${socialNotes}`
    : "";

  return `You are writing a weekly developer newspaper called "the changelog" for GitHub user ${user}.
Week: ${weekStr}

RAW DATA:

COMMITS BY REPO (${data.totalCommits} total):
${commitSummary}

PULL REQUESTS:
${prSummary}

NEW REPOS:
${newRepoSummary || "  (none)"}

ISSUES CLOSED:
${issueSummary || "  (none)"}
${socialSection}

STRICT RULES:
- Only reference PRs, issues, repos, and events that appear in the data above. No invented history.
- Do not describe a project as "young", "new", or make up backstory not in the data.
- If commits are 0 for a repo, don't mention it as active.
- Pull quote must be a real quote derivable from a PR title or issue title in the data.
- Dates in articles must match the actual createdAt/mergedAt dates in the data.

Write punchy, creative newspaper-style content. Headlines should be dramatic and unexpected — not generic tech blog titles.
Think: The Economist meets Hacker News. Short, sharp, sometimes witty.

Return ONLY valid JSON in this exact shape (no markdown, no code blocks):
{
  "heroHeadline": "...",
  "heroDeck": "...",
  "heroBody": "...(2-3 paragraphs, ~200 words total, HTML allowed for <a> links and <code>)",
  "sectionStories": [
    { "tag": "repo-name · topic", "headline": "...", "body": "...(1-2 paragraphs, ~80 words)" },
    { "tag": "repo-name · topic", "headline": "...", "body": "...(1-2 paragraphs, ~80 words)" },
    { "tag": "repo-name · topic", "headline": "...", "body": "...(1-2 paragraphs, ~80 words)" }
  ],
  "pullQuote": "...(one punchy sentence from the week's work, like a real pull quote)",
  "editionBarItems": ["...", "...", "...", "..."] 
}

Use real PR numbers and URLs from the data in heroBody and section bodies.
Pick the 3 most interesting repos/stories for sectionStories.
editionBarItems: 4 short stats or highlights (e.g. "sqlever: 20 PRs merged").`;
}

export async function generateContent(config: Config, data: GitHubData, socialNotes?: string): Promise<GeneratedContent> {
  const prompt = buildPrompt(config.githubUser, data, config.weekStart, config.weekEnd, socialNotes);

  let responseText: string;

  if (config.llmProvider === "anthropic") {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": config.llmApiKey!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.llmModel,
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const json = await resp.json() as any;
    responseText = json.content[0].text;

  } else if (config.llmProvider === "openai") {
    const baseUrl = config.llmBaseUrl || "https://api.openai.com/v1";
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.llmApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.llmModel,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2000,
      }),
    });
    const json = await resp.json() as any;
    responseText = json.choices[0].message.content;

  } else {
    // Ollama
    const baseUrl = config.llmBaseUrl || "http://localhost:11434";
    const resp = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: config.llmModel,
        prompt,
        stream: false,
      }),
    });
    const json = await resp.json() as any;
    responseText = json.response;
  }

  // Strip markdown code fences if present
  responseText = responseText.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();

  try {
    return JSON.parse(responseText) as GeneratedContent;
  } catch {
    throw new Error(`LLM returned invalid JSON:\n${responseText.slice(0, 500)}`);
  }
}
