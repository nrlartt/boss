import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "../config.ts";
import { isBossError } from "../lib/errors.ts";
import { loadMandate, saveMandate, setKillSwitch } from "../policy/mandate.ts";
import { getReceipt, listReceipts } from "../receipts/store.ts";
import { getPlan } from "../desk/session.ts";
import * as desk from "../desk/service.ts";
import { attachLive } from "../market/live.ts";
import { createBossMcpServer } from "../mcp/tools.ts";
import { bootFailed, printBootBanner, runBootGuards } from "../audit/boot.ts";
import { startAuditWatch } from "../audit/watch.ts";
import type { Mandate } from "../types.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const publicDir = path.join(root, "public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

export function startHttp(): void {
  const server = createServer((req, res) => {
    void handle(req, res);
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`BOSS: port ${config.port} is already in use.`);
      process.exit(1);
    }
    throw error;
  });
  server.listen(config.port, config.host, () => {
    const base = config.publicUrl || `http://127.0.0.1:${config.port}`;
    console.log(`BOSS desk ${base}`);
    console.log(`BOSS MCP  ${base}/mcp`);
    if (config.hosted) console.log("BOSS hosted mode — public demo, no API keys required.");
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${config.port}`);
  try {
    if (req.method === "OPTIONS") {
      cors(res);
      res.writeHead(204);
      res.end();
      return;
    }
    if (url.pathname === "/mcp") {
      await handleMcp(req, res);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await api(req, res, url);
      return;
    }
    serveStatic(url.pathname, res);
  } catch (error) {
    sendError(res, error);
  }
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const p = url.pathname;
  const method = req.method ?? "GET";

  if (method === "GET" && p === "/api/klines") {
    const symbol = url.searchParams.get("symbol") ?? "BTCUSDT";
    const interval = url.searchParams.get("interval") === "4h" ? "4h" : "1h";
    return json(res, await desk.chartKlines(symbol, interval));
  }
  if (method === "GET" && p === "/api/plans") return json(res, desk.planHistory());
  if (method === "GET" && p === "/api/alerts") return json(res, desk.alertSnapshot());
  if (method === "POST" && p === "/api/alerts") {
    const body = (await readJson(req)) as Parameters<typeof desk.addAlert>[0];
    return json(res, desk.addAlert(body));
  }
  if (method === "DELETE" && p.startsWith("/api/alerts/")) {
    const id = p.slice("/api/alerts/".length);
    return json(res, desk.removeAlert(id));
  }
  if (method === "GET" && p === "/api/analyze") {
    const symbol = url.searchParams.get("symbol") ?? "BTCUSDT";
    return json(res, await desk.analyze(symbol));
  }
  if (method === "GET" && p === "/api/health") return json(res, await desk.health());
  if (method === "GET" && p === "/api/boot") return json(res, { guards: desk.session().boot });
  if (method === "GET" && p === "/api/session") return json(res, desk.session());
  if (method === "GET" && p === "/api/tape") return json(res, await desk.tape());
  if (method === "GET" && p === "/api/quote") {
    const symbol = url.searchParams.get("symbol") ?? "BTCUSDT";
    return json(res, await desk.quote(symbol));
  }
  if (method === "GET" && p === "/api/live") {
    const symbol = url.searchParams.get("symbol") ?? "BTCUSDT";
    attachLive(req, res, symbol);
    return;
  }
  if (method === "GET" && p === "/api/mandate") return json(res, loadMandate());
  if (method === "GET" && p === "/api/account") return json(res, desk.session().account);
  if (method === "GET" && p === "/api/receipts") return json(res, listReceipts().slice(0, 30));
  if (method === "GET" && p.startsWith("/api/receipts/")) {
    const id = p.slice("/api/receipts/".length);
    const receipt = getReceipt(id);
    if (!receipt) throw Object.assign(new Error("Receipt not found"), { status: 404 });
    return json(res, receipt);
  }
  if (method === "GET" && p.startsWith("/api/plans/")) {
    return json(res, getPlan(p.slice("/api/plans/".length)));
  }
  if (method === "GET" && p === "/api/observe") {
    const symbol = url.searchParams.get("symbol") ?? "BTCUSDT";
    return json(res, await desk.observe(symbol));
  }
  if (method === "GET" && p === "/api/signals") {
    const symbol = url.searchParams.get("symbol") ?? "BTCUSDT";
    return json(res, await desk.gateSignals(symbol));
  }
  if (method === "PUT" && p === "/api/mandate") {
    const body = (await readJson(req)) as Mandate;
    return json(res, saveMandate({ ...loadMandate(), ...body, version: 1, product: "SPOT" }));
  }
  if (method === "POST" && p === "/api/kill") {
    const body = (await readJson(req)) as { on: boolean };
    return json(res, setKillSwitch(Boolean(body.on)));
  }
  if (method === "POST" && p === "/api/command") {
    const body = (await readJson(req)) as { command: string };
    return json(res, await desk.runCommand(String(body.command ?? "")));
  }
  if (method === "POST" && p === "/api/plan") {
    const body = (await readJson(req)) as Parameters<typeof desk.planFromFields>[0];
    return json(res, await desk.planFromFields(body));
  }
  if (method === "POST" && p === "/api/account/host") {
    const body = (await readJson(req)) as Parameters<typeof desk.hostObserveAccount>[0];
    return json(res, desk.hostObserveAccount(body));
  }
  if (method === "POST" && p === "/api/account/api") {
    return json(res, await desk.refreshAccountFromApi());
  }
  if (method === "POST" && p === "/api/account/clear") {
    return json(res, desk.detachAccount());
  }
  if (method === "POST" && p === "/api/approve") {
    const body = (await readJson(req)) as { planId: string; phrase: string };
    return json(res, desk.approvePlan(body.planId, body.phrase));
  }
  if (method === "GET" && p === "/api/packet") {
    const planId = url.searchParams.get("planId") ?? "";
    const approvalId = url.searchParams.get("approvalId") ?? "";
    return json(res, desk.readPacket(planId, approvalId));
  }
  if (method === "POST" && p === "/api/send") {
    const body = (await readJson(req)) as {
      planId: string;
      approvalId: string;
      prefer?: "agent-os" | "direct-api";
    };
    return json(res, await desk.sendApproved(body));
  }
  if (method === "POST" && p === "/api/reconcile") {
    const body = (await readJson(req)) as Parameters<typeof desk.recordReconcile>[0];
    return json(res, desk.recordReconcile(body));
  }
  if (method === "GET" && p === "/api/audit") return json(res, desk.auditSnapshot());
  if (method === "POST" && p === "/api/audit/ingest") {
    const body = (await readJson(req)) as Parameters<typeof desk.ingestExchangeOrder>[0];
    return json(res, desk.ingestExchangeOrder(body));
  }
  if (method === "POST" && p === "/api/scope/restore") {
    return json(res, desk.restoreTradeScope());
  }

  json(res, { error: { code: "NOT_FOUND", message: `No route ${method} ${p}` } }, 404);
}

function serveStatic(pathname: string, res: ServerResponse): void {
  let relative = pathname;
  if (pathname === "/" || pathname === "") {
    relative = "landing/index.html";
  } else if (pathname === "/app" || pathname === "/app/") {
    relative = "index.html";
  } else if (pathname === "/docs" || pathname === "/docs/") {
    relative = "docs/index.html";
  } else if (pathname.startsWith("/app/")) {
    relative = pathname.slice(5);
  } else {
    relative = pathname.replace(/^\/+/, "");
  }
  const file = path.normalize(path.join(publicDir, relative));
  const rootNorm = path.normalize(publicDir + path.sep);
  if (!file.startsWith(rootNorm) || !existsSync(file)) {
    json(res, { error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    return;
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  res.end(readFileSync(file));
}

function json(res: ServerResponse, body: unknown, status = 200): void {
  cors(res);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  cors(res);
  const method = req.method ?? "GET";
  const accept = String(req.headers.accept ?? "");

  // Browsers hit GET /mcp without MCP Accept headers. That is not a client.
  if (method === "GET" && !accept.includes("text/event-stream")) {
    json(res, {
      ok: true,
      service: "BOSS",
      transport: "streamable-http",
      desk: `${config.publicUrl || `http://127.0.0.1:${config.port}`}/app/`,
      mcp: `${config.publicUrl || `http://127.0.0.1:${config.port}`}/mcp`,
      hint: "Open the live desk at /app/. This URL is for MCP clients.",
    });
    return;
  }

  // Stateless Streamable HTTP cannot reuse one transport across requests.
  const mcpServer = createBossMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  transport.onerror = (error) => {
    console.error("BOSS MCP:", error);
  };
  await mcpServer.connect(transport);

  const shutdown = (): void => {
    void transport.close();
    void mcpServer.close();
  };
  res.on("close", shutdown);

  try {
    if (method === "POST") {
      const body = await readJson(req);
      await transport.handleRequest(req, res, body);
      return;
    }
    await transport.handleRequest(req, res);
  } catch (error) {
    shutdown();
    throw error;
  }
}

function cors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader(
    "access-control-allow-headers",
    "content-type, mcp-session-id, mcp-protocol-version, last-event-id, authorization",
  );
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Body too large");
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function sendError(res: ServerResponse, error: unknown): void {
  if (isBossError(error)) {
    json(
      res,
      { error: { code: error.code, message: error.message, hint: error.hint } },
      error.status,
    );
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  const status = (error as { status?: number }).status ?? 500;
  json(res, { error: { code: "ERROR", message } }, status);
}

const guards = await runBootGuards();
printBootBanner(guards);
if (bootFailed(guards)) {
  console.error("BOSS refused to start: a boot guard failed.");
  process.exit(1);
}
startHttp();
startAuditWatch();
