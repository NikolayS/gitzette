export function weeklyGenerationEnabled(toml: string): boolean {
  const config = Bun.TOML.parse(toml) as { vars?: { WEEKLY_GENERATION_ENABLED?: unknown } };
  const value = config.vars?.WEEKLY_GENERATION_ENABLED;
  if (value !== "true" && value !== "false") {
    throw new Error("invalid WEEKLY_GENERATION_ENABLED");
  }
  return value === "true";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(args: string[]): Promise<void> {
  const [configPath] = args;
  if (!configPath) throw new Error("usage: bun scripts/weekly-generation-flag.ts <wrangler.toml>");
  let toml: string;
  try {
    toml = await Bun.file(configPath).text();
  } catch (error) {
    throw new Error(`could not read weekly generation config: ${formatError(error)}`);
  }
  process.stdout.write(String(weeklyGenerationEnabled(toml)));
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(formatError(error));
    process.exitCode = 1;
  });
}
