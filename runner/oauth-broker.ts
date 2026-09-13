/** Local inference boundary: credentials and refresh locks stay with OpenClaw's owner. */
import { mkdtemp, rm, chmod } from "node:fs/promises";
import { join } from "node:path";
import { TEXT_MODEL, IMAGE_MODEL } from "../src/models";
import { classifyOpenClawFailure, OpenClawInferenceError } from "./inference-error";

const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_PROMPT = 96 * 1024;
export const OAUTH_PROFILE_ID = "openai:nik@postgres.ai";
type Request = { operation: "write" | "generate" | "review"; prompt: string; image?: string };

export function validateBrokerRequest(value: unknown): Request {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid request");
  const v = value as Record<string, unknown>;
  if (!["write", "generate", "review"].includes(String(v.operation)) || typeof v.prompt !== "string"
    || Buffer.byteLength(v.prompt) > MAX_PROMPT || !v.prompt.length) throw new Error("invalid operation or prompt");
  const expected = v.operation === "review" ? ["operation", "prompt", "image"] : ["operation", "prompt"];
  if (Object.keys(v).length !== expected.length || Object.keys(v).some(k => !expected.includes(k))) throw new Error("unexpected request field");
  if (v.operation === "review") {
    if (typeof v.image !== "string" || v.image.length > Math.ceil(MAX_IMAGE / 3) * 4
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(v.image) || Buffer.from(v.image, "base64").length > MAX_IMAGE) throw new Error("invalid image");
  }
  return v as Request;
}

export function brokerArguments(request: Request, directory: string): string[] {
  // The caller cannot choose an executable, model, config, URL, or host file path.
  if (request.operation === "write") return ["infer", "model", "run", "--local", "--json", "--model", TEXT_MODEL, "--thinking", "medium", "--prompt", request.prompt];
  if (request.operation === "review") return ["infer", "image", "describe", "--json", "--model", TEXT_MODEL, "--file", join(directory, "input.webp"), "--prompt", request.prompt];
  return ["infer", "image", "generate", "--json", "--model", IMAGE_MODEL, "--count", "1", "--size", "1024x1024", "--output-format", "png", "--background", "opaque", "--quality", "medium", "--output", join(directory, "output.png"), "--prompt", request.prompt];
}

export async function brokerInference(socket: string, argv: string[], timeout: number): Promise<string> {
  if (!socket.startsWith("/")) throw new Error("inference socket must be an absolute local path");
  const prompt = argv[argv.indexOf("--prompt") + 1];
  const operation = argv[2] === "model" ? "write" : argv[3] === "generate" ? "generate" : argv[3] === "describe" ? "review" : undefined;
  if (!operation) throw new Error("unsupported broker operation");
  const request: Request = { operation, prompt };
  if (operation === "review") {
    const file = Bun.file(argv[argv.indexOf("--file") + 1]);
    if (file.size > MAX_IMAGE) throw new Error("image exceeds broker limit");
    request.image = Buffer.from(await file.arrayBuffer()).toString("base64");
  }
  validateBrokerRequest(request);
  const response = await fetch("http://localhost/infer", { unix: socket, method: "POST", body: JSON.stringify(request), signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new OpenClawInferenceError(response.status, response.status === 401 ? '{"error":{"code":"invalid_oauth"}}' : `local inference broker failed (${response.status})`);
  const result = await response.json() as { output: string; image?: string };
  if (typeof result.output !== "string" || result.output.length > 2_000_000) throw new Error("invalid broker response");
  if (operation === "generate") {
    if (typeof result.image !== "string" || result.image.length > Math.ceil(MAX_IMAGE / 3) * 4) throw new Error("invalid generated image");
    await Bun.write(argv[argv.indexOf("--output") + 1], Buffer.from(result.image, "base64"));
  }
  return result.output;
}

export async function startBroker(options: { socket: string; state: string; config: string; work: string; node: string; cli: string; beforeRequest?: () => void; bodyTimeoutMs?: number; inferenceTimeoutMs?: number }) {
  validateBrokerConfig(await Bun.file(options.config).json());
  let busy = false;
  const server = Bun.serve({ unix: options.socket, maxRequestBodySize: 12 * 1024 * 1024,
    async fetch(req, server) {
      server.timeout(req, 0); // Inference has its own bounded child deadline.
      if (req.method !== "POST" || new URL(req.url).pathname !== "/infer") return new Response(null, { status: 404 });
      if (busy) return new Response(null, { status: 503 });
      busy = true;
      let directory: string | undefined;
      try {
        let request: Request;
        try { request = validateBrokerRequest(JSON.parse(await boundedText(req.body!, 12 * 1024 * 1024, options.bodyTimeoutMs ?? 5000))); } catch { return new Response(null, { status: 400 }); }
        options.beforeRequest?.();
        directory = await mkdtemp(join(options.work, "inference-"));
        if (request.image) await Bun.write(join(directory, "input.webp"), Buffer.from(request.image, "base64"));
        const child = Bun.spawn([options.node, options.cli, ...brokerArguments(request, directory)], {
          cwd: directory, detached: true, stdin: "ignore", stdout: "pipe", stderr: "pipe",
          env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: options.work, TMPDIR: directory,
            OPENCLAW_STATE_DIR: options.state, OPENCLAW_CONFIG_PATH: options.config },
        });
        const abort = () => { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } };
        req.signal.addEventListener("abort", abort, { once: true });
        if (req.signal.aborted) abort();
        const deadline = options.inferenceTimeoutMs ?? 600_000;
        const timer = setTimeout(abort, deadline);
        let output: string, stderr: string, code: number;
        try { [output, stderr, code] = await Promise.all([boundedText(child.stdout, 2_000_000, deadline + 1000), boundedText(child.stderr, 100_000, deadline + 1000), child.exited]); }
        catch { abort(); await child.exited; throw new Error("inference output exceeded limit"); }
        finally { clearTimeout(timer); req.signal.removeEventListener("abort", abort); }
        // Raw provider diagnostics never cross the socket or enter logs.
        if (code !== 0) return new Response(null, { status: (classifyOpenClawFailure(stderr) === "auth" || classifyOpenClawFailure(output) === "auth") ? 401 : 502 });
        let image: string | undefined;
        if (request.operation === "generate") {
          const file = Bun.file(join(directory, "output.png"));
          if (file.size > MAX_IMAGE) return new Response(null, { status: 502 });
          image = Buffer.from(await file.arrayBuffer()).toString("base64");
        }
        return Response.json({ output, image });
      } catch (error) { return new Response(null, { status: error instanceof OpenClawInferenceError && error.kind === "auth" ? 401 : 502 }); }
      finally { try { if (directory) await rm(directory, { recursive: true, force: true }); } finally { busy = false; } }
    },
  });
  await chmod(options.socket, 0o660);
  return server;
}

export function validateBrokerConfig(config: any): void {
  const main = config?.agents?.entries?.main;
  const profiles = config?.auth?.profiles;
  const order = config?.auth?.order?.openai;
  if (JSON.stringify(config?.tools?.deny) !== '["*"]' || config?.tools?.elevated?.enabled !== false
    || JSON.stringify(main?.tools?.deny) !== '["*"]' || Object.keys(config?.channels ?? {}).length
    || JSON.stringify(config?.agents?.defaults?.model?.fallbacks) !== '[]'
    || !Array.isArray(order) || order.length !== 1 || order[0] !== OAUTH_PROFILE_ID || Object.keys(profiles ?? {}).length !== 1
    || profiles[order[0]]?.provider !== "openai" || profiles[order[0]]?.mode !== "oauth") {
    throw new Error("broker requires sealed tools, no channels/fallbacks, and one OAuth profile");
  }
}

async function boundedText(stream: ReadableStream<Uint8Array>, limit: number, timeoutMs: number): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("stream deadline exceeded")), timeoutMs); });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("response too large");
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { clearTimeout(timer!); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
