import { readFileSync } from "fs";

export function loadSocialNotes(filePath?: string): string {
  if (!filePath) return "";
  try {
    return readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}
