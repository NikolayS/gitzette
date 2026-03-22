import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { html } from "hono/html";
import { authRoutes } from "./auth";
import { generateRoutes } from "./generate";
import { pageRoutes } from "./pages";
import { reviewRoutes } from "./review";

export interface Env {
  DB: D1Database;
  DISPATCHES: R2Bucket;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GITHUB_TOKEN: string;
  OPENROUTER_API_KEY: string;
  GOOGLE_AI_KEY: string;
  SESSION_SECRET: string;
  WEEKLY_REGEN_LIMIT: string;
  MONTHLY_LLM_BUDGET_USD: string;
  NEWSPAPERIFY_URL: string;
  NEWSPAPERIFY_SECRET: string;
}

const app = new Hono<{ Bindings: Env }>();

// ── auth ─────────────────────────────────────────────────────────────────────
app.route("/auth", authRoutes);

// ── generation ────────────────────────────────────────────────────────────────
app.route("/generate", generateRoutes);

// ── review / feedback ─────────────────────────────────────────────────────────
app.route("/review", reviewRoutes);

// ── public dispatch pages ─────────────────────────────────────────────────────
app.route("/", pageRoutes);

export default app;
