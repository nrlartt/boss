import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as desk from "../desk/service.ts";
import { loadMandate, saveMandate, setKillSwitch } from "../policy/mandate.ts";
import { getReceipt, listReceipts } from "../receipts/store.ts";
import { getPlan } from "../desk/session.ts";

export function createBossMcpServer(): McpServer {
  const server = new McpServer({ name: "boss", version: "1.0.0" });

  function text(data: unknown) {
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  }

  server.registerTool(
    "boss_status",
    {
      description:
        "Show BOSS health, Binance public-data reachability, mandate, attached account, and MCP URL.",
    },
    async () => text({ health: await desk.health(), mandate: loadMandate(), session: desk.session() }),
  );

  server.registerTool(
    "boss_tape",
    { description: "Live Binance Spot 24h tape for BTC, ETH, BNB, SOL, XRP." },
    async () => text(await desk.tape()),
  );

  server.registerTool(
    "boss_analyze",
    {
      description:
        "Full research report for a Spot symbol: live market structure, Web3 trend boards, public news RSS, and a scored summary. Never invents prices.",
      inputSchema: { symbol: z.string().describe("Spot symbol such as BTCUSDT or BTC") },
    },
    async ({ symbol }) => text(await desk.analyze(symbol)),
  );

  server.registerTool(
    "boss_observe",
    {
      description:
        "Fetch live Spot ticker, depth, filters, 1h SMA, and Binance Web3 signal boards for a symbol. Never invents prices.",
      inputSchema: { symbol: z.string().describe("Spot symbol such as BTCUSDT or BTC") },
    },
    async ({ symbol }) => text(await desk.observe(symbol)),
  );

  server.registerTool(
    "boss_plan",
    {
      description:
        "Parse a natural-language Spot command, observe live markets, size the order to exchange filters, and run the fail-closed policy gate. Does not send an order.",
      inputSchema: {
        command: z.string().describe('Example: "plan buy 50 usdt BTCUSDT" or "analyze ETHUSDT"'),
      },
    },
    async ({ command }) => text(await desk.runCommand(command)),
  );

  server.registerTool(
    "boss_attach_account",
    {
      description:
        "Attach a host-observed account snapshot from Binance Agent OS (balances only). Labelled HOST_OBSERVED. Required before BALANCE_SUFFICIENT can PASS.",
      inputSchema: {
        balances: z.array(z.object({ asset: z.string(), free: z.string() })),
        capturedAt: z.string().optional(),
        source: z.string().optional(),
      },
    },
    async (input) => text(desk.hostObserveAccount(input)),
  );

  server.registerTool(
    "boss_approve",
    {
      description:
        "Issue a one-time approval token for a CLEAR plan. phrase must be exactly EXECUTE. Does not send the order.",
      inputSchema: {
        planId: z.string(),
        phrase: z.string().describe("Must be EXECUTE"),
      },
    },
    async ({ planId, phrase }) => text(desk.approvePlan(planId, phrase)),
  );

  server.registerTool(
    "boss_packet",
    {
      description:
        "Return the Agent OS execution packet. Does not consume the approval and does not place the order.",
      inputSchema: { planId: z.string(), approvalId: z.string() },
    },
    async ({ planId, approvalId }) => text(desk.readPacket(planId, approvalId)),
  );

  server.registerTool(
    "boss_send_direct",
    {
      description:
        "Send the approved Spot order through optional signed Binance API keys on this machine. Consumes the approval only after a successful ack.",
      inputSchema: { planId: z.string(), approvalId: z.string() },
    },
    async ({ planId, approvalId }) =>
      text(await desk.sendApproved({ planId, approvalId, prefer: "direct-api" })),
  );

  server.registerTool(
    "boss_reconcile",
    {
      description:
        "Record the order id returned by Binance Agent OS after a send. Pass the stamp in clientOrderId. Pass approvalId to consume the token. Classifies AUTHORISED / FOREIGN / FORGED / MISMATCHED.",
      inputSchema: {
        planId: z.string(),
        orderId: z.string(),
        approvalId: z.string().optional(),
        clientOrderId: z.string().optional(),
        raw: z.any().optional(),
      },
    },
    async (input) => text(desk.recordReconcile(input)),
  );

  server.registerTool(
    "boss_ingest_order",
    {
      description:
        "Ingest an exchange order (from Agent OS history or signed REST) for stamp classification. FOREIGN/FORGED/MISMATCHED burns trade scope.",
      inputSchema: {
        orderId: z.string(),
        clientOrderId: z.string().nullable().optional(),
        symbol: z.string(),
        side: z.string(),
        type: z.string(),
        quantity: z.string(),
        price: z.string().nullable().optional(),
        status: z.string().optional(),
        raw: z.any().optional(),
      },
    },
    async (input) =>
      text(
        desk.ingestExchangeOrder({
          orderId: input.orderId,
          clientOrderId: input.clientOrderId ?? null,
          symbol: input.symbol,
          side: input.side,
          type: input.type,
          quantity: input.quantity,
          price: input.price ?? null,
          status: input.status,
          raw: input.raw,
        }),
      ),
  );

  server.registerTool(
    "boss_audit",
    {
      description: "Show trade scope, stamp counters, and recent audit events for the desk.",
    },
    async () => text(desk.auditSnapshot()),
  );

  server.registerTool(
    "boss_receipt",
    {
      description: "Read a BOSS receipt by id, or list recent receipts.",
      inputSchema: { id: z.string().optional() },
    },
    async ({ id }) => text(id ? getReceipt(id) : listReceipts().slice(0, 20)),
  );

  server.registerTool(
    "boss_mandate",
    {
      description: "Read or replace the local mandate (notional caps, kill switch, allowlists).",
      inputSchema: {
        update: z
          .object({
            killSwitch: z.boolean().optional(),
            maxNotionalUsdt: z.string().optional(),
            maxDailyNotionalUsdt: z.string().optional(),
            maxPriceDeviationBps: z.string().optional(),
            maxSpreadBps: z.string().optional(),
            symbolAllowlist: z.array(z.string()).optional(),
          })
          .optional(),
      },
    },
    async ({ update }) => {
      if (!update) return text(loadMandate());
      if (update.killSwitch !== undefined && Object.keys(update).length === 1) {
        return text(setKillSwitch(update.killSwitch));
      }
      return text(saveMandate({ ...loadMandate(), ...update, version: 1, product: "SPOT" }));
    },
  );

  server.registerTool(
    "boss_plan_get",
    {
      description: "Return a plan stored by this BOSS desk (shared with the web UI).",
      inputSchema: { planId: z.string() },
    },
    async ({ planId }) => text(getPlan(planId)),
  );

  return server;
}
