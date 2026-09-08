import { config, hasDirectApiKeys } from "../config.ts";
import { BossError } from "../lib/errors.ts";
import { fetchQuote, fetchTickers, fetchKlines, normalizeSymbol, observeSymbol } from "../market/binance.ts";
import { sparkHistory } from "../market/live.ts";
import { mergeTapeSymbols } from "../market/symbols.ts";
import { listPlans } from "./session.ts";
import * as alerts from "./alerts.ts";
import { buildAnalysisReport } from "../analysis/report.ts";
import { fetchSocialPulse } from "../analysis/research.ts";
import { fetchSignalBoard } from "../market/signals.ts";
import { fetchApiAccount, placeSpotOrder } from "../market/signed.ts";
import { buildPlan } from "../plan/planner.ts";
import { parseCommand } from "./parseCommand.ts";
import { loadMandate } from "../policy/mandate.ts";
import { dailyNotionalUsed, writeReceipt } from "../receipts/store.ts";
import {
  attachAccount,
  assertFreshPlan,
  clearAccount,
  consumeApproval,
  currentAccount,
  getPlan,
  issueApproval,
  peekApproval,
  putPlan,
} from "./session.ts";
import { issueAuthorization, getAuthorizationByApproval } from "../audit/authorizations.ts";
import { auditCounters, auditSeries, ingestObservedOrder, listAuditEvents } from "../audit/events.ts";
import { lastBootGuards } from "../audit/boot.ts";
import { loadScope, restoreScope } from "../audit/scope.ts";
import type { ObservedOrder } from "../audit/types.ts";
import type { AccountSnapshot, AnalysisReport, ExecutionPacket, Observation, Plan } from "../types.ts";

export async function health() {
  const started = Date.now();
  try {
    const ticker = await fetchTickers(["BTCUSDT"]);
    const row = ticker[0];
    const base = config.publicUrl || `http://127.0.0.1:${config.port}`;
    return {
      ok: true,
      service: "BOSS",
      hosted: config.hosted,
      engine: "live",
      publicUrl: base,
      binanceSpot: {
        reachable: true,
        sample: row ? { symbol: row.symbol, last: row.lastPrice, changePct: row.priceChangePercent } : null,
        latencyMs: Date.now() - started,
      },
      directApi: hasDirectApiKeys(),
      account: accountSummary(),
      mcp: `${base}/mcp`,
      scope: loadScope(),
      audit: auditCounters(),
      boot: lastBootGuards().map((row) => ({ id: row.id, status: row.status })),
    };
  } catch (error) {
    const base = config.publicUrl || `http://127.0.0.1:${config.port}`;
    return {
      ok: false,
      service: "BOSS",
      hosted: config.hosted,
      engine: "offline",
      publicUrl: base,
      binanceSpot: {
        reachable: false,
        error: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - started,
      },
      directApi: hasDirectApiKeys(),
      account: accountSummary(),
      mcp: `${base}/mcp`,
      scope: loadScope(),
      audit: auditCounters(),
      boot: lastBootGuards().map((row) => ({ id: row.id, status: row.status })),
    };
  }
}

function accountSummary() {
  const account = currentAccount();
  if (!account) return { mode: "ABSENT" as const, assets: [] as string[] };
  return { mode: account.mode, assets: account.balances.map((row) => `${row.asset}:${row.free}`) };
}

export function session() {
  const mandate = loadMandate();
  return {
    account: currentAccount(),
    mandate,
    directApi: hasDirectApiKeys(),
    accountSummary: accountSummary(),
    scope: loadScope(),
    audit: auditCounters(),
    dailyNotional: dailyNotionalUsed(),
    boot: lastBootGuards(),
  };
}

export function detachAccount() {
  clearAccount();
  return { account: null };
}

export async function tape() {
  const symbols = mergeTapeSymbols(config.watchSymbols);
  const rows = await fetchTickers(symbols);
  const mapped = new Map(
    rows.map((row) => [
      row.symbol,
      {
        symbol: row.symbol,
        last: row.lastPrice,
        changePct: row.priceChangePercent,
        high: row.highPrice,
        low: row.lowPrice,
        quoteVolume: row.quoteVolume,
      },
    ]),
  );
  return {
    asOf: new Date().toISOString(),
    source: "binance-spot-public /api/v3/ticker/24hr",
    rows: symbols.map((symbol) => mapped.get(symbol)).filter((row): row is NonNullable<typeof row> => Boolean(row)),
    sparks: sparkHistory(),
  };
}

export async function quote(symbol: string) {
  return fetchQuote(symbol);
}

export async function gateSignals(symbolRaw: string) {
  const symbol = normalizeSymbol(symbolRaw);
  const base = symbol.replace(/USDT|USDC|FDUSD$/i, "");
  const [signals, macro, tapeData] = await Promise.all([
    fetchSignalBoard(symbol),
    fetchSocialPulse(base),
    tape(),
  ]);
  const rows = [...tapeData.rows].sort((a, b) => Number(b.changePct) - Number(a.changePct));
  const gainers = rows.filter((row) => Number(row.changePct) > 0).slice(0, 4);
  const losers = rows.filter((row) => Number(row.changePct) < 0).slice(-4).reverse();
  return {
    asOf: new Date().toISOString(),
    symbol,
    base,
    signals,
    macro,
    tapeMovers: { gainers, losers },
  };
}

export async function analyze(symbol: string): Promise<{
  observation: Observation;
  signals: Awaited<ReturnType<typeof fetchSignalBoard>>;
  account: AccountSnapshot | null;
  analysis: AnalysisReport;
}> {
  const { observation, signals, account } = await observe(symbol);
  const tapeSnapshot = await tape();
  const analysis = await buildAnalysisReport({
    observation,
    signals,
    tape: tapeSnapshot.rows.map((row) => ({
      symbol: row.symbol,
      changePct: row.changePct,
      quoteVolume: row.quoteVolume,
    })),
  });
  return { observation, signals, account, analysis };
}

export async function observe(symbol: string): Promise<{
  observation: Observation;
  signals: Awaited<ReturnType<typeof fetchSignalBoard>>;
  account: AccountSnapshot | null;
}> {
  const observation = await observeSymbol(symbol);
  const signals = await fetchSignalBoard(observation.symbol);
  return { observation, signals, account: currentAccount() };
}

export async function runCommand(command: string) {
  const intent = parseCommand(command);
  if (intent.action === "observe") {
    const payload = await analyze(intent.symbol);
    return { kind: "observe" as const, intent, ...payload };
  }
  const { observation, signals, account } = await observe(intent.symbol);
  const plan = putPlan(
    buildPlan({
      intent,
      observation,
      signals,
      account,
      mandate: loadMandate(),
      dailyNotional: dailyNotionalUsed(),
    }),
  );
  const receipt = writeReceipt({
    stage: plan.policy.verdict === "BLOCK" ? "BLOCKED" : "PREVIEW",
    verdict: plan.policy.verdict,
    plan,
    summary: `${plan.policy.verdict} ${plan.order.side} ${plan.order.quantity} ${plan.order.symbol}`,
  });
  return { kind: "plan" as const, intent, plan, receipt };
}

export async function planFromFields(input: {
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "LIMIT" | "MARKET";
  quoteQty?: string;
  baseQty?: string;
  limitPrice?: string;
}) {
  const command = [
    "plan",
    input.orderType === "MARKET" ? "market" : "limit",
    input.side.toLowerCase(),
    input.quoteQty ? `${input.quoteQty} usdt` : "",
    input.baseQty ?? "",
    normalizeSymbol(input.symbol),
    input.limitPrice ? `@ ${input.limitPrice}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return runCommand(command);
}

export async function refreshAccountFromApi() {
  const snapshot = await fetchApiAccount();
  return attachAccount(snapshot);
}

export function hostObserveAccount(input: {
  capturedAt?: string;
  balances: { asset: string; free: string }[];
  source?: string;
}) {
  if (!input.balances?.length) {
    throw new BossError("ACCOUNT", "Host-observed account requires at least one balance row.");
  }
  return attachAccount({
    mode: "HOST_OBSERVED",
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    balances: input.balances,
    source: input.source ?? "binance-agent-os host-observed",
  });
}

export function approvePlan(planId: string, phrase: string) {
  if (phrase.trim().toUpperCase() !== "EXECUTE") {
    throw new BossError("APPROVAL", 'Type EXECUTE exactly to issue a one-time approval token.');
  }
  const plan = getPlan(planId);
  const mandate = loadMandate();
  const approval = issueApproval(plan, mandate.approvalTtlMs);
  const stamp = issueAuthorization(plan, approval.id);
  const packet = executionPacket(plan, approval.id, approval.expiresAt, stamp.clientOrderId);
  writeReceipt({
    stage: "APPROVED",
    verdict: plan.policy.verdict,
    plan,
    summary: `Approved ${plan.id} until ${approval.expiresAt} stamp=${stamp.clientOrderId}`,
    packet,
  });
  return { approval, packet, stamp };
}

export function readPacket(planId: string, approvalId: string) {
  const plan = getPlan(planId);
  const approval = peekApproval(approvalId, plan);
  const stamp = issueAuthorization(plan, approval.id);
  const packet = executionPacket(plan, approval.id, approval.expiresAt, stamp.clientOrderId);
  return { approval, packet, stamp };
}

export async function sendApproved(input: {
  planId: string;
  approvalId: string;
  prefer?: "agent-os" | "direct-api";
}) {
  const plan = getPlan(input.planId);
  const live = await observeSymbol(plan.order.symbol);
  assertFreshPlan(plan, live, loadMandate().maxPriceDeviationBps);

  const prefer = input.prefer ?? (hasDirectApiKeys() ? "direct-api" : "agent-os");
  const peeked = peekApproval(input.approvalId, plan);
  const stamp = issueAuthorization(plan, peeked.id);
  const packet = executionPacket(plan, peeked.id, peeked.expiresAt, stamp.clientOrderId);

  if (prefer === "direct-api" && hasDirectApiKeys()) {
    try {
      const ack = await placeSpotOrder(plan, stamp.clientOrderId);
      consumeApproval(input.approvalId, plan);
      const receipt = writeReceipt({
        stage: "SENT",
        verdict: plan.policy.verdict,
        plan,
        summary: `Sent ${plan.order.side} ${plan.order.quantity} ${plan.order.symbol} orderId=${ack.orderId}`,
        execution: {
          venue: "direct-api",
          status: "sent",
          orderId: String(ack.orderId),
          clientOrderId: ack.clientOrderId,
          raw: ack,
        },
        packet,
      });
      ingestObservedOrder({
        orderId: String(ack.orderId),
        clientOrderId: ack.clientOrderId ?? stamp.clientOrderId,
        symbol: plan.order.symbol,
        side: plan.order.side,
        type: plan.order.type,
        quantity: plan.order.quantity,
        price: plan.order.price,
        status: ack.status,
        raw: ack,
      });
      return { sent: true, venue: "direct-api" as const, ack, receipt, packet };
    } catch (error) {
      const receipt = writeReceipt({
        stage: "UNSENT",
        verdict: plan.policy.verdict,
        plan,
        summary: `Direct API rejected the send: ${error instanceof Error ? error.message : String(error)}`,
        execution: {
          venue: "direct-api",
          status: "rejected",
          orderId: null,
          clientOrderId: null,
          raw: { error: error instanceof Error ? error.message : String(error) },
        },
        packet,
      });
      throw error instanceof BossError
        ? error
        : new BossError("SEND_FAILED", receipt.summary, 502);
    }
  }

  const receipt = writeReceipt({
    stage: "UNSENT",
    verdict: plan.policy.verdict,
    plan,
    summary:
      "Approval is live. Send these exact params through Binance Agent OS MCP. BOSS did not place the order.",
    execution: {
      venue: "agent-os-mcp",
      status: "not-sent",
      orderId: null,
      clientOrderId: stamp.clientOrderId,
      raw: null,
    },
    packet,
  });
  return { sent: false, venue: "agent-os-mcp" as const, ack: null, receipt, packet };
}

export function recordReconcile(input: {
  planId: string;
  orderId: string;
  approvalId?: string;
  clientOrderId?: string;
  raw?: unknown;
}) {
  const plan = getPlan(input.planId);
  if (input.approvalId) consumeApproval(input.approvalId, plan);
  const stamp = input.approvalId ? getAuthorizationByApproval(input.approvalId) : null;
  const clientOrderId = input.clientOrderId ?? stamp?.clientOrderId ?? null;
  const event = ingestObservedOrder({
    orderId: input.orderId,
    clientOrderId,
    symbol: plan.order.symbol,
    side: plan.order.side,
    type: plan.order.type,
    quantity: plan.order.quantity,
    price: plan.order.price,
    raw: input.raw ?? null,
  });
  const receipt = writeReceipt({
    stage: "SENT",
    verdict: plan.policy.verdict,
    plan,
    summary: `Reconciled Agent OS send orderId=${input.orderId} outcome=${event?.outcome ?? "duplicate"}`,
    execution: {
      venue: "agent-os-mcp",
      status: "sent",
      orderId: input.orderId,
      clientOrderId,
      raw: input.raw ?? null,
    },
  });
  return { receipt, event, scope: loadScope() };
}

export function ingestExchangeOrder(order: ObservedOrder) {
  const event = ingestObservedOrder(order);
  return { event, scope: loadScope(), duplicate: event === null };
}

export function auditSnapshot() {
  return {
    scope: loadScope(),
    counters: auditCounters(),
    series: auditSeries(),
    events: listAuditEvents().slice(0, 40),
  };
}

export function restoreTradeScope() {
  return restoreScope();
}

export function planHistory() {
  return listPlans().map((plan) => ({
    id: plan.id,
    createdAt: plan.createdAt,
    symbol: plan.order.symbol,
    side: plan.order.side,
    type: plan.order.type,
    quantity: plan.order.quantity,
    notional: plan.order.notional,
    verdict: plan.policy.verdict,
    pass: plan.policy.passCount,
    fail: plan.policy.failCount,
    unknown: plan.policy.unknownCount,
    planHash: plan.planHash.slice(0, 12),
  }));
}

export async function chartKlines(symbolRaw: string, interval: "1h" | "4h") {
  const symbol = normalizeSymbol(symbolRaw);
  const limit = interval === "4h" ? 72 : 96;
  const rows = await fetchKlines(symbol, interval, limit);
  return {
    symbol,
    interval,
    asOf: new Date().toISOString(),
    candles: rows.map((row) => ({
      t: row[0],
      open: row[1],
      high: row[2],
      low: row[3],
      close: row[4],
      volume: row[5],
    })),
  };
}

export function alertSnapshot() {
  return alerts.listAlerts();
}

export function addAlert(input: Parameters<typeof alerts.createAlert>[0]) {
  return alerts.createAlert(input);
}

export function removeAlert(id: string) {
  alerts.deleteAlert(id);
  return { ok: true };
}

function executionPacket(
  plan: Plan,
  approvalId: string,
  expiresAt: string,
  newClientOrderId: string,
): ExecutionPacket {
  return {
    venue: "binance-spot",
    via: "agent-os-mcp",
    instruction:
      "Discover Binance Agent OS MCP tools at runtime. Send this Spot order with these exact fields, including newClientOrderId. Do not change quantity, price, side, or the stamp. Do not retry on an unknown result.",
    params: {
      symbol: plan.order.symbol,
      side: plan.order.side,
      type: plan.order.type,
      timeInForce: plan.order.timeInForce ?? undefined,
      quantity: plan.order.quantity,
      price: plan.order.price ?? undefined,
      newClientOrderId,
    },
    approvalId,
    planId: plan.id,
    planHash: plan.planHash,
    expiresAt,
  };
}
