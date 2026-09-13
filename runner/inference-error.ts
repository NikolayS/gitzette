export type OpenClawFailureKind = "auth" | "unknown";

const AUTH_STATUS_CODES = new Set([401, 403]);
const AUTH_ERROR_CODES = new Set([
  "auth_error",
  "authentication_error",
  "invalid_auth",
  "invalid_oauth",
  "oauth_expired",
  "oauth_token_expired",
  "session_expired",
  "token_expired",
  "unauthenticated",
  "unauthorized",
  "forbidden",
]);
const AUTH_MESSAGE_FALLBACK = /(?:not logged in|login required|sign[ -]?in required|(?:oauth|authentication|session|token|credential).{0,40}(?:expired|invalid|missing|revoked|unauthori[sz]ed)|\bhttp(?:\/[0-9.]+)?[ :=-]*(?:401|403)\b|\bstatus(?: code)?[ =:]*(?:401|403)\b)/i;

export class OpenClawInferenceError extends Error {
  readonly kind: OpenClawFailureKind;

  constructor(readonly exitCode: number, readonly detail: string) {
    super(`OpenClaw inference failed (${exitCode}): ${detail}`);
    this.name = "OpenClawInferenceError";
    this.kind = classifyOpenClawFailure(detail);
  }
}

export function classifyOpenClawFailure(detail: string): OpenClawFailureKind {
  const candidates = [detail.trim(), ...detail.trim().split(/\r?\n/).reverse()];
  for (const candidate of candidates) {
    if (!candidate.startsWith("{") || !candidate.endsWith("}")) continue;
    try {
      if (hasStructuredAuthSignal(JSON.parse(candidate))) return "auth";
    } catch {
      // OpenClaw can prefix diagnostics before its final JSON envelope. Only
      // complete JSON candidates are considered structured signals.
    }
  }
  return AUTH_MESSAGE_FALLBACK.test(detail) ? "auth" : "unknown";
}

function hasStructuredAuthSignal(value: unknown, depth = 0): boolean {
  if (!isRecord(value) || depth > 3) return false;
  for (const [key, field] of Object.entries(value)) {
    if ((key === "status" || key === "statusCode") && authStatus(field)) return true;
    if ((key === "code" || key === "type" || key === "error")
      && typeof field === "string"
      && AUTH_ERROR_CODES.has(field.toLowerCase())) return true;
    if (hasStructuredAuthSignal(field, depth + 1)) return true;
  }
  return false;
}

function authStatus(value: unknown): boolean {
  const status = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof status === "number" && AUTH_STATUS_CODES.has(status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

