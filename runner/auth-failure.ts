import { OpenClawInferenceError } from "./inference";

const AUTH_CLASS_DETAIL = /(?:\b(?:oauth|unauthori[sz]ed|authentication)\b|not logged in|login required|sign[ -]?in required|(?:session|token|credential).{0,40}(?:expired|invalid|missing|revoked)|\bhttp(?:\/[0-9.]+)?[ :=-]*(?:401|403)\b|\bstatus(?: code)?[ =:]*(?:401|403)\b)/i;

export function isOAuthAuthFailure(error: unknown): boolean {
  return error instanceof OpenClawInferenceError && AUTH_CLASS_DETAIL.test(error.detail);
}
