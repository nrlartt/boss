import { D, asFixed } from "../lib/money.ts";
import type { Observation } from "../types.ts";

export type TechnicalSnapshot = {
  rangePositionPct: number;
  rsi14_1h: number | null;
  trendLabel: "up" | "down" | "flat";
  findings: string[];
};

export function buildTechnicalSnapshot(
  observation: Observation,
  closes1h: string[],
): TechnicalSnapshot {
  const last = D(observation.last);
  const low = D(observation.low24h);
  const high = D(observation.high24h);
  const span = high.minus(low);
  const rangePositionPct = span.lte(0)
    ? 50
    : Number(last.minus(low).div(span).times(100).toFixed(1));

  const rsi14_1h = closes1h.length >= 15 ? rsi(closes1h, 14) : null;
  const change = Number(observation.change24hPct);
  const smaBps = observation.lastVsSma20Bps ? Number(observation.lastVsSma20Bps) : null;
  const imbalance = Number(observation.book.imbalance);
  const spread = Number(observation.spreadBps);

  const findings: string[] = [];
  if (rangePositionPct >= 75) findings.push(`Price sits in the upper ${rangePositionPct.toFixed(0)}% of the 24h range.`);
  else if (rangePositionPct <= 25) findings.push(`Price sits in the lower ${rangePositionPct.toFixed(0)}% of the 24h range.`);
  else findings.push(`Price is mid-range at ${rangePositionPct.toFixed(0)}% of the 24h band.`);

  if (smaBps !== null) {
    if (smaBps > 50) findings.push(`Last is ${smaBps.toFixed(0)} bps above the 1h SMA20.`);
    else if (smaBps < -50) findings.push(`Last is ${Math.abs(smaBps).toFixed(0)} bps below the 1h SMA20.`);
    else findings.push("Last is within 50 bps of the 1h SMA20.");
  } else {
    findings.push("Not enough 1h candles for SMA20 context.");
  }

  if (rsi14_1h !== null) {
    if (rsi14_1h >= 70) findings.push(`RSI(14) on 1h is ${rsi14_1h.toFixed(1)} — stretched to the upside.`);
    else if (rsi14_1h <= 30) findings.push(`RSI(14) on 1h is ${rsi14_1h.toFixed(1)} — stretched to the downside.`);
    else findings.push(`RSI(14) on 1h is ${rsi14_1h.toFixed(1)} — neutral zone.`);
  }

  if (imbalance > 0.15) findings.push(`Order book imbalance ${imbalance.toFixed(3)} favours bids.`);
  else if (imbalance < -0.15) findings.push(`Order book imbalance ${imbalance.toFixed(3)} favours asks.`);
  else findings.push(`Order book is balanced (imbalance ${imbalance.toFixed(3)}).`);

  if (spread > 8) findings.push(`Spread is wide at ${spread.toFixed(2)} bps for Spot.`);
  else findings.push(`Spread is tight at ${spread.toFixed(2)} bps.`);

  const trendLabel: TechnicalSnapshot["trendLabel"] =
    change > 0.35 ? "up" : change < -0.35 ? "down" : "flat";

  return { rangePositionPct, rsi14_1h, trendLabel, findings };
}

function rsi(closes: string[], period: number): number {
  const values = closes.map((row) => Number(row));
  if (values.length < period + 1) return 50;
  let gain = 0;
  let loss = 0;
  for (let i = values.length - period; i < values.length; i += 1) {
    const curr = values[i];
    const prev = values[i - 1];
    if (curr === undefined || prev === undefined) continue;
    const delta = curr - prev;
    if (delta >= 0) gain += delta;
    else loss -= delta;
  }
  const avgGain = gain / period;
  const avgLoss = loss / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Number((100 - 100 / (1 + rs)).toFixed(1));
}

export function volumeQuoteLabel(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (n >= 1_000_000_000) return `${asFixed(D(n).div(1_000_000_000))}B USDT`;
  if (n >= 1_000_000) return `${asFixed(D(n).div(1_000_000))}M USDT`;
  if (n >= 1_000) return `${asFixed(D(n).div(1_000))}K USDT`;
  return `${asFixed(D(n))} USDT`;
}
