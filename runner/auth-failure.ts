const OPENCLAW_INFERENCE_FAILURE = /OpenClaw inference failed/i;
const AUTH_CLASS_DETAIL = /(?:\b(?:401|403|oauth|unauthori[sz]ed|authentication)\b|not logged in|login required|sign[ -]?in required|(?:session|token|credential).{0,40}(?:expired|invalid|missing|revoked))/i;

export function isOAuthAuthFailure(message: string): boolean {
  return OPENCLAW_INFERENCE_FAILURE.test(message) && AUTH_CLASS_DETAIL.test(message);
}
