export type TokenSource = "none" | "estimated" | "provider";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  tokenSource: TokenSource;
};

export type JobUsage = TokenUsage & {
  imageCount: number;
  wallTimeMs: number;
};

const MAX_TOKENS_PER_JOB = 10_000_000;
const MAX_IMAGES_PER_JOB = 3;
const MAX_WALL_TIME_MS = 6 * 60 * 60 * 1000;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(new TextEncoder().encode(text).byteLength / 4);
}

export function measuredOrEstimatedUsage(
  envelope: unknown,
  input: string,
  output: string,
): TokenUsage {
  const usage = (envelope as { usage?: { inputTokens?: unknown; outputTokens?: unknown } } | null)?.usage;
  if (isBoundedInteger(usage?.inputTokens, MAX_TOKENS_PER_JOB)
    && isBoundedInteger(usage?.outputTokens, MAX_TOKENS_PER_JOB)) {
    return {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      tokenSource: "provider",
    };
  }
  return {
    inputTokens: estimateTokens(input),
    outputTokens: estimateTokens(output),
    tokenSource: "estimated",
  };
}

export function combineTokenUsage(total: TokenUsage, addition: TokenUsage): TokenUsage {
  return {
    inputTokens: total.inputTokens + addition.inputTokens,
    outputTokens: total.outputTokens + addition.outputTokens,
    tokenSource: total.tokenSource === "estimated" || addition.tokenSource === "estimated"
      ? "estimated"
      : total.tokenSource === "provider" || addition.tokenSource === "provider"
        ? "provider"
        : "none",
  };
}

export function validateJobUsage(value: unknown): JobUsage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid job usage");
  const input = value as Record<string, unknown>;
  const allowed = new Set(["inputTokens", "outputTokens", "tokenSource", "imageCount", "wallTimeMs"]);
  const unknown = Object.keys(input).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`unknown job usage field: ${unknown}`);
  if (!isBoundedInteger(input.inputTokens, MAX_TOKENS_PER_JOB)
    || !isBoundedInteger(input.outputTokens, MAX_TOKENS_PER_JOB)
    || !isBoundedInteger(input.imageCount, MAX_IMAGES_PER_JOB)
    || !isBoundedInteger(input.wallTimeMs, MAX_WALL_TIME_MS)
    || typeof input.tokenSource !== "string"
    || !["none", "estimated", "provider"].includes(input.tokenSource)) {
    throw new Error("invalid job usage");
  }
  if (input.tokenSource === "none" && (input.inputTokens !== 0 || input.outputTokens !== 0)) {
    throw new Error("token source none requires zero tokens");
  }
  return input as JobUsage;
}

function isBoundedInteger(value: unknown, maximum: number): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}
