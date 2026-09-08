import { describe, expect, it } from "vitest";
import { buildPlan } from "../src/plan/planner.ts";
import { DEFAULT_MANDATE } from "../src/policy/mandate.ts";
import { parseCommand } from "../src/desk/parseCommand.ts";
import type { Observation, SignalBoard } from "../src/types.ts";

const observation: Observation = {
  asOf: new Date().toISOString(),
  fetchedAtMs: Date.now(),
  symbol: "BTCUSDT",
  status: "TRADING",
  last: "78383.02",
  bid: "78383.01",
  ask: "78383.02",
  mid: "78383.015",
  spreadBps: "0.001",
  change24hPct: "-1.3",
  high24h: "80000",
  low24h: "77000",
  volumeBase: "10",
  volumeQuote: "800000000",
  book: {
    lastUpdateId: 1,
    bids: [{ price: "78383.01", qty: "1" }],
    asks: [{ price: "78383.02", qty: "1" }],
    bidQtyTop: "1",
    askQtyTop: "1",
    imbalance: "0",
  },
  sma20_1h: "78000",
  lastVsSma20Bps: "49",
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

describe("planner", () => {
  it("sizes a 50 USDT buy to LOT_SIZE and tickSize", () => {
    const plan = buildPlan({
      intent: parseCommand("plan buy 50 usdt BTCUSDT"),
      observation,
      signals,
      account: null,
      mandate: DEFAULT_MANDATE,
      dailyNotional: "0",
    });
    expect(plan.order.symbol).toBe("BTCUSDT");
    expect(plan.order.side).toBe("BUY");
    expect(plan.order.price).toBe("78383.01");
    expect(Number(plan.order.quantity)).toBeGreaterThan(0);
    expect(Number(plan.order.notional)).toBeGreaterThanOrEqual(5);
    expect(plan.policy.verdict).toBe("UNKNOWN");
  });
});
