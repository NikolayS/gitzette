#!/usr/bin/env bun
import { loadConfig } from "./config.ts";
import { fetchGitHubActivity } from "./github.ts";
import { generateContent } from "./llm.ts";
import { renderHTML } from "./render.ts";
import { loadSocialNotes } from "./social.ts";
import { writeFileSync } from "fs";

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
gitzette — turn your GitHub activity into a weekly newspaper

USAGE:
  bun src/index.ts [options]

OPTIONS:
  --user      GitHub username (or GITHUB_USER env)
  --token     GitHub token (or GITHUB_TOKEN env)
  --week      Week to generate: YYYY-WNN or YYYY-MM-DD start date (default: last week)
  --llm       LLM provider: anthropic | openai | ollama (default: anthropic)
  --model     Model name (default: claude-sonnet-4-5 / gpt-4o / llama3)
  --api-key   LLM API key (or ANTHROPIC_API_KEY / OPENAI_API_KEY env)
  --llm-url   Custom LLM base URL (for Ollama or compatible APIs)
  --title     Newspaper title (default: "the changelog")
  --output    Output HTML file (default: gitzette-YYYY-MM-DD.html)

EXAMPLES:
  bun src/index.ts --user NikolayS --token ghp_xxx --api-key sk-ant-xxx
  bun src/index.ts --user NikolayS --week 2026-W12
  bun src/index.ts --user NikolayS --llm ollama --model llama3
`);
    process.exit(0);
  }

  let config;
  try {
    config = loadConfig(args);
  } catch (e: any) {
    console.error("Error:", e.message);
    process.exit(1);
  }

  console.log(`📰 Fetching GitHub activity for ${config.githubUser}...`);
  console.log(`   Week: ${config.weekStart.toDateString()} – ${config.weekEnd.toDateString()}`);

  const data = await fetchGitHubActivity(
    config.githubUser,
    config.githubToken,
    config.weekStart,
    config.weekEnd,
    config.forkRepos,
  );

  console.log(`   ${data.totalCommits} commits, ${data.pullRequests.length} PRs, ${data.newRepos.length} new repos`);
  const socialNotes = loadSocialNotes(config.socialFile);
  if (socialNotes) console.log("   Social notes loaded from", config.socialFile);

  console.log(`✍️  Generating content with ${config.llmProvider}/${config.llmModel}...`);

  const content = await generateContent(config, data, socialNotes);

  console.log(`🖨️  Rendering HTML...`);
  const html = renderHTML(config, data, content);

  writeFileSync(config.outputFile, html);
  console.log(`✅ Saved to ${config.outputFile}`);
}

main().catch(e => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
