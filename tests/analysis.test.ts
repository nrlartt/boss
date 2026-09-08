import { describe, expect, it } from "vitest";
import { buildTechnicalSnapshot } from "../src/analysis/technicals.ts";
import type { Observation } from "../src/types.ts";

const baseObservation = (): Observation => ({
  asOf: new Date().toISOString(),
  fetchedAtMs: Date.now(),
  symbol: "BTCUSDT",
  status: "TRADING",
  last: "100",
  bid: "99.9",
  ask: "100.1",
  mid: "100",
  spreadBps: "2",
  change24hPct: "1.2",
  high24h: "110",
  low24h: "90",
  volumeBase: "1000",
  volumeQuote: "100000000",
  book: {
    lastUpdateId: 1,
    bids: [{ price: "99.9", qty: "1" }],
    asks: [{ price: "100.1", qty: "1" }],
    bidQtyTop: "5",
    askQtyTop: "3",
    imbalance: "0.25",
  },
  sma20_1h: "98",
  lastVsSma20Bps: "200",
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
    maxNotional: null,
  },
  sources: {
    ticker: "test",
    depth: "test",
    klines: "test",
    exchangeInfo: "test",
  },
});

describe("buildTechnicalSnapshot", () => {
  it("computes range position and findings", () => {
    const snap = buildTechnicalSnapshot(baseObservation(), Array.from({ length: 20 }, (_, i) => String(95 + i)));
    expect(snap.rangePositionPct).toBe(50);
    expect(snap.findings.length).toBeGreaterThan(3);
    expect(snap.rsi14_1h).not.toBeNull();
  });
});
