import { BossError } from "../lib/errors.ts";
import { normalizeSymbol } from "../market/binance.ts";
import type { Intent, OrderType, Side } from "../types.ts";

const KNOWN: Record<string, string> = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  BNB: "BNBUSDT",
  SOL: "SOLUSDT",
  XRP: "XRPUSDT",
  DOGE: "DOGEUSDT",
  ADA: "ADAUSDT",
  AVAX: "AVAXUSDT",
  LINK: "LINKUSDT",
  TRX: "TRXUSDT",
  DOT: "DOTUSDT",
  POL: "POLUSDT",
  MATIC: "POLUSDT",
  LTC: "LTCUSDT",
  UNI: "UNIUSDT",
  ATOM: "ATOMUSDT",
  NEAR: "NEARUSDT",
  APT: "APTUSDT",
  ARB: "ARBUSDT",
  OP: "OPUSDT",
  SUI: "SUIUSDT",
};

export function parseCommand(raw: string): Intent {
  const text = raw.trim();
  if (!text) throw new BossError("BAD_COMMAND", "Empty command.");
  const lower = text.toLowerCase();

  const orderType: OrderType = /\bmarket\b/.test(lower) ? "MARKET" : "LIMIT";
  const side = readSide(lower);
  const symbol = readSymbol(text);
  const limitPrice = readLimit(lower);
  const quoteQty = readQuote(lower);
  const baseQty = quoteQty ? null : readBase(lower, symbol);

  const action: Intent["action"] =
    side || quoteQty || baseQty || /\b(plan|buy|sell|order)\b/.test(lower) ? "plan" : "observe";

  if (action === "plan" && !side) {
    throw new BossError(
      "BAD_COMMAND",
      "A plan needs a side. Example: plan buy 50 usdt BTCUSDT",
    );
  }

  return {
    raw: text,
    action,
    symbol,
    side,
    orderType,
    quoteQty,
    baseQty,
    limitPrice,
  };
}

function readSide(lower: string): Side | null {
  if (/\bbuy\b|\blong\b/.test(lower)) return "BUY";
  if (/\bsell\b|\bshort\b/.test(lower)) return "SELL";
  return null;
}

function readSymbol(text: string): string {
  const tokens = text.toUpperCase().match(/[A-Z]{2,12}(USDT|USDC|FDUSD)?/g) ?? [];
  const skip = new Set([
    "PLAN",
    "BUY",
    "SELL",
    "LONG",
    "SHORT",
    "MARKET",
    "LIMIT",
    "USDT",
    "USDC",
    "ANALYZE",
    "OBSERVE",
    "WATCH",
    "ORDER",
    "SPOT",
    "OF",
    "FOR",
    "THE",
  ]);
  for (const token of tokens) {
    if (skip.has(token)) continue;
    if (KNOWN[token]) return KNOWN[token];
    if (token.endsWith("USDT") || token.endsWith("USDC") || token.endsWith("FDUSD")) {
      return normalizeSymbol(token);
    }
    if (token.length >= 2 && token.length <= 10) return normalizeSymbol(token);
  }
  return "BTCUSDT";
}

function readQuote(lower: string): string | null {
  const match =
    lower.match(/\b(\d+(?:\.\d+)?)\s*(?:usdt|usdc|usd)\b/) ||
    lower.match(/\b(?:usdt|usdc|usd)\s*(\d+(?:\.\d+)?)\b/);
  return match?.[1] ?? null;
}

function readBase(lower: string, symbol: string): string | null {
  const base = symbol.replace(/USDT|USDC|FDUSD$/i, "").toLowerCase();
  const match =
    lower.match(new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*${base}\\b`)) ||
    lower.match(/\b(?:qty|quantity|size)\s*(\d+(?:\.\d+)?)\b/);
  return match?.[1] ?? null;
}

function readLimit(lower: string): string | null {
  const match = lower.match(/@\s*(\d+(?:\.\d+)?)|\bat\s+(\d+(?:\.\d+)?)/);
  return match?.[1] ?? match?.[2] ?? null;
}
