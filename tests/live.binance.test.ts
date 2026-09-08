import { describe, expect, it } from "vitest";
import { observeSymbol } from "../src/market/binance.ts";

describe("live Binance public feed", () => {
  it("returns a real BTCUSDT book and last price", async () => {
    const obs = await observeSymbol("BTCUSDT");
    expect(obs.symbol).toBe("BTCUSDT");
    expect(obs.status).toBe("TRADING");
    expect(Number(obs.last)).toBeGreaterThan(0);
    expect(Number(obs.bid)).toBeGreaterThan(0);
    expect(Number(obs.ask)).toBeGreaterThanOrEqual(Number(obs.bid));
    expect(obs.filters.quoteAsset).toBe("USDT");
  }, 20_000);
});
