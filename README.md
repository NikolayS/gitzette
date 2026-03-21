# gitzette

Turn your GitHub activity into a weekly newspaper — AI-generated headlines, styled HTML output.

Fetches your commits, PRs, issues, and new repos for any week, sends the data to an LLM, and renders a styled HTML newspaper.

## Quick start

```bash
git clone https://github.com/NikolayS/gitzette
cd gitzette
cp .env.example .env  # fill in your tokens
bun src/index.ts
```

## Options

```
--user      GitHub username (or GITHUB_USER env)
--token     GitHub token with repo read scope (or GITHUB_TOKEN env)
--week      Week: YYYY-WNN or YYYY-MM-DD start date (default: last week)
--llm       Provider: anthropic | openai | ollama (default: anthropic)
--model     Model name (default: claude-sonnet-4-5 / gpt-4o / llama3)
--api-key   LLM API key
--llm-url   Custom LLM base URL (for Ollama or compatible APIs)
--title     Newspaper title (default: "the changelog")
--output    Output HTML file (default: gitzette-YYYY-MM-DD.html)
```

## Examples

```bash
# Anthropic (default)
bun src/index.ts --user NikolayS --token ghp_xxx --api-key sk-ant-xxx

# OpenAI
bun src/index.ts --user NikolayS --token ghp_xxx --llm openai --api-key sk-xxx

# Ollama (local, no API key needed)
bun src/index.ts --user NikolayS --token ghp_xxx --llm ollama --model llama3

# Specific week
bun src/index.ts --user NikolayS --week 2026-W12

# Custom title
bun src/index.ts --user NikolayS --title "samo.log"
```

## Requirements

- [Bun](https://bun.sh) runtime
- GitHub personal access token (read:user, repo scopes)
- API key for your chosen LLM provider (or Ollama running locally)

## License

Apache 2.0
