import { describe, expect, it } from "vitest";
import { buildPlan } from "../src/plan/planner.ts";
import { parseCommand } from "../src/desk/parseCommand.ts";
import { DEFAULT_MANDATE } from "../src/policy/mandate.ts";
import { issueApproval, peekApproval, putPlan } from "../src/desk/session.ts";
import type { Observation, SignalBoard } from "../src/types.ts";

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

describe("approval", () => {
  it("refuses UNKNOWN plans and keeps CLEAR tokens unused until consume", () => {
    const unknown = putPlan(
      buildPlan({
        intent: parseCommand("plan buy 50 usdt BTCUSDT"),
        observation,
        signals,
        account: null,
        mandate: DEFAULT_MANDATE,
        dailyNotional: "0",
      }),
    );
    expect(unknown.policy.verdict).toBe("UNKNOWN");
    expect(() => issueApproval(unknown, 60_000)).toThrow(/CLEAR/);

    const clear = putPlan(
      buildPlan({
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
      }),
    );
    expect(clear.policy.verdict).toBe("CLEAR");
    const approval = issueApproval(clear, 60_000);
    const peeked = peekApproval(approval.id, clear);
    expect(peeked.used).toBe(false);
    expect(peeked.id).toBe(approval.id);
  });
});
