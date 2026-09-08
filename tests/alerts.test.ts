import { describe, expect, it } from "vitest";
import { mergeTapeSymbols } from "../src/market/symbols.ts";
import { checkAlerts, createAlert, deleteAlert } from "../src/desk/alerts.ts";

describe("mergeTapeSymbols", () => {
  it("dedupes extra symbols", () => {
    const rows = mergeTapeSymbols(["BTCUSDT", "FOOUSDT"]);
    expect(rows.filter((row) => row === "BTCUSDT")).toHaveLength(1);
    expect(rows).toContain("FOOUSDT");
    expect(rows.length).toBeGreaterThan(10);
  });
});

describe("alerts", () => {
  it("fires above alert", () => {
    const alert = createAlert({ symbol: "BTCUSDT", direction: "above", price: "100" });
    const fired = checkAlerts("BTCUSDT", "100.5");
    expect(fired.some((row) => row.id === alert.id)).toBe(true);
    deleteAlert(alert.id);
  });
});
