import { describe, expect, it } from "vitest";
import {
  inspectClientOrderId,
  macMatches,
  mintClientOrderId,
  stampMac,
} from "../src/stamp/clientOrderId.ts";
import { hmacSecret } from "../src/stamp/secret.ts";
import { mandateHash } from "../src/policy/mandate.ts";
import { classifyObservedOrder } from "../src/audit/classify.ts";
import { issueAuthorization } from "../src/audit/authorizations.ts";
import { buildPlan } from "../src/plan/planner.ts";
import { parseCommand } from "../src/desk/parseCommand.ts";
import { DEFAULT_MANDATE } from "../src/policy/mandate.ts";
import type { Observation, SignalBoard } from "../src/types.ts";

const secret = "unit-test-hmac-secret-unit-test-hmac-secret";

const observation: Observation = {
  asOf: new Date().toISOString(),
  fetchedAtMs: Date.now(),
  symbol: "BTCUSDT",
  status: "TRADING",
  last: "100.00",
  bid: "99.99",
  ask: "100.01",
  mid: "100.00",
  spreadBps: "2",
  change24hPct: "0",
  high24h: "101",
  low24h: "99",
  volumeBase: "10",
  volumeQuote: "1000",
  book: {
    lastUpdateId: 1,
    bids: [{ price: "99.99", qty: "2" }],
    asks: [{ price: "100.01", qty: "2" }],
    bidQtyTop: "20",
    askQtyTop: "20",
    imbalance: "0",
  },
  sma20_1h: "99",
  lastVsSma20Bps: "10",
  filters: {
    status: "TRADING",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    tickSize: "0.01",
    minPrice: "0.01",
    maxPrice: "1000000",
    stepSize: "0.00001",
    minQty: "0.00001",
    maxQty: "9000",
    minNotional: "5",
    maxNotional: "9000000",
  },
  sources: { ticker: "t", depth: "t", klines: "t", exchangeInfo: "t" },
};

const signals: SignalBoard = {
  asOf: new Date().toISOString(),
  trending: [],
  smartMoney: [],
  symbolHits: { trending: null, smartMoney: null },
  sources: { trending: "t", smartMoney: "t" },
};

describe("stamped clientOrderId", () => {
  it("mints a boss_ tag whose HMAC covers seq + mandate hash", () => {
    const id = mintClientOrderId(7, "abc", secret);
    expect(id).toMatch(/^boss_000007_[0-9a-f]{16}$/);
    const tagged = inspectClientOrderId(id);
    expect(tagged.kind).toBe("tagged");
    if (tagged.kind !== "tagged") return;
    expect(tagged.seq).toBe(7);
    expect(macMatches(7, "abc", tagged.mac, secret)).toBe(true);
    expect(macMatches(7, "other", tagged.mac, secret)).toBe(false);
  });

  it("classifies absent and unsigned ids as FOREIGN", () => {
    expect(inspectClientOrderId(null).kind).toBe("absent");
    expect(inspectClientOrderId("x-U123").kind).toBe("foreign");
    const foreign = classifyObservedOrder({
      orderId: "1",
      clientOrderId: "web_order_99",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      quantity: "0.1",
      price: "99.99",
    });
    expect(foreign.outcome).toBe("FOREIGN");
  });

  it("classifies a boss_ prefix with a bad MAC as FORGED", () => {
    expect(inspectClientOrderId("boss_not-a-stamp").kind).toBe("malformed");
    const forged = classifyObservedOrder({
      orderId: "2",
      clientOrderId: "boss_000001_ffffffffffffffff",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      quantity: "0.1",
      price: "99.99",
    });
    expect(forged.outcome).toBe("FORGED");
  });

  it("classifies a valid tag with no record as UNKNOWN_AUTHENTIC", () => {
    const hash = mandateHash();
    const id = mintClientOrderId(999999, hash, hmacSecret());
    const row = classifyObservedOrder({
      orderId: "3",
      clientOrderId: id,
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      quantity: "0.1",
      price: "99.99",
    });
    expect(row.outcome).toBe("UNKNOWN_AUTHENTIC");
  });

  it("matches an issued authorization as AUTHORISED and a mutated fill as MISMATCHED", () => {
    const plan = buildPlan({
      intent: parseCommand("plan buy 50 usdt BTCUSDT"),
      observation,
      signals,
      account: {
        mode: "HOST_OBSERVED",
        capturedAt: new Date().toISOString(),
        source: "test",
        balances: [{ asset: "USDT", free: "80" }],
      },
      mandate: DEFAULT_MANDATE,
      dailyNotional: "0",
    });
    const auth = issueAuthorization(plan, `appr_test_${Date.now()}`);
    const ok = classifyObservedOrder({
      orderId: "4",
      clientOrderId: auth.clientOrderId,
      symbol: auth.symbol,
      side: auth.side,
      type: auth.type,
      quantity: auth.quantity,
      price: auth.price,
    });
    expect(ok.outcome).toBe("AUTHORISED");

    const bad = classifyObservedOrder({
      orderId: "5",
      clientOrderId: auth.clientOrderId,
      symbol: auth.symbol,
      side: "SELL",
      type: auth.type,
      quantity: auth.quantity,
      price: auth.price,
    });
    expect(bad.outcome).toBe("MISMATCHED");
  });

  it("exports a stable MAC helper", () => {
    expect(stampMac(1, "h", secret)).toHaveLength(16);
  });
});
