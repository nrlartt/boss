import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "../src/policy/engine.ts";
import { DEFAULT_MANDATE } from "../src/policy/mandate.ts";
import { alignDown, alignUp, isMultiple } from "../src/lib/money.ts";
import type { Observation, Plan } from "../src/types.ts";

function obs(over: Partial<Observation> = {}): Observation {
  const now = Date.now();
  return {
    asOf: new Date(now).toISOString(),
    fetchedAtMs: now,
    symbol: "BTCUSDT",
    status: "TRADING",
    last: "100.00",
    bid: "99.99",
    ask: "100.01",
    mid: "100.00",
    spreadBps: "2",
    change24hPct: "1.2",
    high24h: "101",
    low24h: "99",
    volumeBase: "10",
    volumeQuote: "1000",
    book: {
      lastUpdateId: 1,
      bids: [{ price: "99.99", qty: "2" }],
      asks: [{ price: "100.01", qty: "2" }],
      bidQtyTop: "2",
      askQtyTop: "2",
      imbalance: "0",
    },
    sma20_1h: "99.5",
    lastVsSma20Bps: "50",
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
    sources: {
      ticker: "test",
      depth: "test",
      klines: "test",
      exchangeInfo: "test",
    },
    ...over,
  };
}

function order(over: Partial<Plan["order"]> = {}): Plan["order"] {
  return {
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    timeInForce: "GTC",
    quantity: "0.1",
    price: "99.99",
    quoteSpend: "9.999",
    notional: "9.999",
    ...over,
  };
}

describe("money", () => {
  it("aligns lot and tick the way Binance expects", () => {
    expect(alignDown("0.000014", "0.00001").toFixed()).toBe("0.00001");
    expect(alignUp("100.001", "0.01").toFixed()).toBe("100.01");
    expect(isMultiple("99.99", "0.01")).toBe(true);
    expect(isMultiple("99.991", "0.01")).toBe(false);
  });
});

describe("policy", () => {
  it("CLEARs a well-sized limit when account covers the buy", () => {
    const result = evaluatePolicy({
      mandate: DEFAULT_MANDATE,
      observation: obs(),
      order: order(),
      account: {
        mode: "HOST_OBSERVED",
        capturedAt: new Date().toISOString(),
        source: "test",
        balances: [{ asset: "USDT", free: "50" }],
      },
      dailyNotional: "0",
    });
    expect(result.failCount).toBe(0);
    expect(result.verdict).toBe("CLEAR");
  });

  it("marks balance UNKNOWN when no account is attached", () => {
    const result = evaluatePolicy({
      mandate: DEFAULT_MANDATE,
      observation: obs(),
      order: order(),
      account: null,
      dailyNotional: "0",
    });
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.rules.find((r) => r.id === "BALANCE_SUFFICIENT")?.status).toBe("UNKNOWN");
  });

  it("BLOCKs kill switch, min notional, and oversize cap", () => {
    const killed = evaluatePolicy({
      mandate: { ...DEFAULT_MANDATE, killSwitch: true },
      observation: obs(),
      order: order(),
      account: null,
      dailyNotional: "0",
    });
    expect(killed.verdict).toBe("BLOCK");

    const dust = evaluatePolicy({
      mandate: DEFAULT_MANDATE,
      observation: obs(),
      order: order({ quantity: "0.00001", notional: "0.001" }),
      account: null,
      dailyNotional: "0",
    });
    expect(dust.rules.find((r) => r.id === "MIN_NOTIONAL")?.status).toBe("FAIL");

    const cap = evaluatePolicy({
      mandate: DEFAULT_MANDATE,
      observation: obs(),
      order: order({ notional: "250" }),
      account: null,
      dailyNotional: "0",
    });
    expect(cap.rules.find((r) => r.id === "MAX_NOTIONAL")?.status).toBe("FAIL");
  });
});
