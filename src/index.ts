import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { html } from "hono/html";
import { authRoutes } from "./auth";
import { queueRoutes } from "./queue";
import { runnerRoutes } from "./runner";
import { pageRoutes } from "./pages";

export interface Env {
  DB: D1Database;
  DISPATCHES: R2Bucket;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GITHUB_TOKEN: string;
  SESSION_SECRET: string;
  STATUS_TOKEN: string;
  WEEKLY_REGEN_LIMIT: string;
  GLOBAL_WEEKLY_GENERATION_LIMIT?: string;
  MAX_QUEUE_AGE_SECONDS?: string;
  NEWSPAPERIFY_URL: string;
  NEWSPAPERIFY_SECRET: string;
  RUNNER_SECRET: string;
  RUNNER_LEASE_SECONDS?: string;
}

const app = new Hono<{ Bindings: Env }>();

// ── auth ─────────────────────────────────────────────────────────────────────
app.route("/auth", authRoutes);

// ── generation ────────────────────────────────────────────────────────────────
app.route("", queueRoutes);
app.route("/runner", runnerRoutes);

// ── public dispatch pages ─────────────────────────────────────────────────────
app.route("/", pageRoutes);

export default app;
