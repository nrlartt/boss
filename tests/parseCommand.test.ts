import { describe, expect, it } from "vitest";
import { parseCommand } from "../src/desk/parseCommand.ts";

describe("parseCommand", () => {
  it("parses a quote-sized limit buy", () => {
    const intent = parseCommand("plan buy 50 usdt BTCUSDT");
    expect(intent.action).toBe("plan");
    expect(intent.side).toBe("BUY");
    expect(intent.symbol).toBe("BTCUSDT");
    expect(intent.quoteQty).toBe("50");
    expect(intent.orderType).toBe("LIMIT");
  });

  it("parses a base-sized sell", () => {
    const intent = parseCommand("plan sell 0.01 btc");
    expect(intent.side).toBe("SELL");
    expect(intent.symbol).toBe("BTCUSDT");
    expect(intent.baseQty).toBe("0.01");
  });

  it("treats analyze as observe", () => {
    const intent = parseCommand("analyze ETH");
    expect(intent.action).toBe("observe");
    expect(intent.symbol).toBe("ETHUSDT");
    expect(intent.side).toBeNull();
  });

  it("reads an explicit limit", () => {
    const intent = parseCommand("plan buy 25 usdt SOL @ 140.5");
    expect(intent.limitPrice).toBe("140.5");
    expect(intent.symbol).toBe("SOLUSDT");
  });
});
