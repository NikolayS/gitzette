export interface Config {
  githubUser: string;
  githubToken: string;
  llmProvider: "anthropic" | "openai" | "ollama";
  llmModel: string;
  llmApiKey?: string;
  llmBaseUrl?: string;
  weekStart: Date;
  weekEnd: Date;
  outputFile: string;
  title: string;
  forkRepos: string[];
  linkedInEmail?: string;
  linkedInPassword?: string;
  twitterUser?: string;
  twitterCookies?: string;
  headless: boolean;
}

export function getWeekRange(weekStr?: string): { start: Date; end: Date } {
  if (weekStr) {
    // Accept YYYY-WNN format e.g. 2026-W12
    const match = weekStr.match(/^(\d{4})-W(\d{2})$/);
    if (match) {
      const year = parseInt(match[1]);
      const week = parseInt(match[2]);
      const jan4 = new Date(year, 0, 4);
      const startOfWeek1 = new Date(jan4);
      startOfWeek1.setDate(jan4.getDate() - jan4.getDay() + 1);
      const start = new Date(startOfWeek1);
      start.setDate(startOfWeek1.getDate() + (week - 1) * 7);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    // Accept YYYY-MM-DD
    const start = new Date(weekStr);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  // Default: last Monday → Sunday
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1) - 7;
  const start = new Date(now.setDate(diff));
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function loadConfig(args: string[]): Config {
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };

  const user = get("--user") || process.env.GITHUB_USER;
  if (!user) throw new Error("--user or GITHUB_USER required");

  const token = get("--token") || process.env.GITHUB_TOKEN;
  if (!token) throw new Error("--token or GITHUB_TOKEN required");

  const provider = (get("--llm") || process.env.LLM_PROVIDER || "anthropic") as Config["llmProvider"];
  const model = get("--model") || process.env.LLM_MODEL ||
    (provider === "anthropic" ? "claude-sonnet-4-5" :
     provider === "openai" ? "gpt-4o" : "llama3");

  const apiKey = get("--api-key") || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
  const baseUrl = get("--llm-url") || process.env.LLM_BASE_URL;

  const { start, end } = getWeekRange(get("--week"));
  const outputFile = get("--output") || `gitzette-${start.toISOString().slice(0, 10)}.html`;
  const title = get("--title") || process.env.GITZETTE_TITLE || "the changelog";

  // --forks owner/repo,owner/repo or GITZETTE_FORKS env
  const forksRaw = get("--forks") || process.env.GITZETTE_FORKS || "";
  const forkRepos = forksRaw ? forksRaw.split(",").map(s => s.trim()).filter(Boolean) : [];

  const linkedInEmail = get("--linkedin-email") || process.env.LINKEDIN_EMAIL;
  const linkedInPassword = get("--linkedin-password") || process.env.LINKEDIN_PASSWORD;
  const twitterUser = get("--twitter") || process.env.TWITTER_USER;
  const twitterCookies = get("--twitter-cookies") || process.env.TWITTER_COOKIES_FILE;
  const headless = !args.includes("--no-headless");

  return { githubUser: user, githubToken: token, llmProvider: provider, llmModel: model, llmApiKey: apiKey, llmBaseUrl: baseUrl, weekStart: start, weekEnd: end, outputFile, title, forkRepos, linkedInEmail, linkedInPassword, twitterUser, twitterCookies, headless };
}
