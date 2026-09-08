/** Default Spot tape — top liquid USDT pairs on Binance. */
export const TAPE_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "TRXUSDT",
  "DOTUSDT",
  "POLUSDT",
  "LTCUSDT",
  "UNIUSDT",
  "ATOMUSDT",
  "NEARUSDT",
  "APTUSDT",
  "ARBUSDT",
  "OPUSDT",
  "SUIUSDT",
] as const;

export type TapeSymbol = (typeof TAPE_SYMBOLS)[number];

export function mergeTapeSymbols(extra: string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const symbol of [...TAPE_SYMBOLS, ...extra.map((row) => row.toUpperCase())]) {
    const clean = symbol.trim().toUpperCase();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}
