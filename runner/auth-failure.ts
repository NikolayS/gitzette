import { OpenClawInferenceError } from "./inference";

export function isOAuthAuthFailure(error: unknown): boolean {
  return error instanceof OpenClawInferenceError && error.kind === "auth";
}
