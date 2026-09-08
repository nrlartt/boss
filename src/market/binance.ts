import { config } from "../config.ts";
import { BossError } from "../lib/errors.ts";
import { getJson } from "../lib/http.ts";
import { asFixed, D } from "../lib/money.ts";
import type { BookLevel, Observation, SymbolFilters } from "../types.ts";

type Ticker24hr = {
  symbol: string;
  lastPrice: string;
  bidPrice: string;
  askPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
};

type Depth = {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
};

type ExchangeInfo = {
  symbols: Array<{
    symbol: string;
    status: string;
    baseAsset: string;
    quoteAsset: string;
    filters: Array<Record<string, string>>;
  }>;
};

type Kline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string,
];

const SOURCE = {
  ticker: "binance-spot-public /api/v3/ticker/24hr",
  depth: "binance-spot-public /api/v3/depth",
  klines: "binance-spot-public /api/v3/klines",
  exchangeInfo: "binance-spot-public /api/v3/exchangeInfo",
} as const;

export function normalizeSymbol(raw: string): string {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) throw new BossError("BAD_SYMBOL", "Missing symbol.");
  if (cleaned.endsWith("USDT") || cleaned.endsWith("USDC") || cleaned.endsWith("FDUSD")) {
    return cleaned;
  }
  return `${cleaned}USDT`;
}

export async function fetchTicker(symbol: string): Promise<Ticker24hr> {
  return getJson<Ticker24hr>(
    `${config.binanceSpotBase}/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`,
  );
}

export async function fetchTickers(symbols: string[]): Promise<Ticker24hr[]> {
  const qs = encodeURIComponent(JSON.stringify(symbols));
  return getJson<Ticker24hr[]>(`${config.binanceSpotBase}/api/v3/ticker/24hr?symbols=${qs}`);
}

export async function fetchDepth(symbol: string, limit = 20): Promise<Depth> {
  return getJson<Depth>(
    `${config.binanceSpotBase}/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`,
  );
}

export async function fetchExchangeInfo(symbol: string): Promise<SymbolFilters> {
  const data = await getJson<ExchangeInfo>(
    `${config.binanceSpotBase}/api/v3/exchangeInfo?symbol=${encodeURIComponent(symbol)}`,
  );
  const info = data.symbols[0];
  if (!info) throw new BossError("BAD_SYMBOL", `Binance has no Spot symbol ${symbol}.`);
  return parseFilters(info);
}

export async function fetchKlines(symbol: string, interval = "1h", limit = 24): Promise<Kline[]> {
  return getJson<Kline[]>(
    `${config.binanceSpotBase}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`,
  );
}

export async function observeSymbol(symbolRaw: string): Promise<Observation> {
  const symbol = normalizeSymbol(symbolRaw);
  const fetchedAtMs = Date.now();
  const [ticker, depth, filters, klines] = await Promise.all([
    fetchTicker(symbol),
    fetchDepth(symbol, 20),
    fetchExchangeInfo(symbol),
    fetchKlines(symbol, "1h", 24),
  ]);

  const bids = levelsFromBook(depth.bids);
  const asks = levelsFromBook(depth.asks);
  const book = summarizeBook(bids, asks, depth.lastUpdateId);

  const closes = klines.map((row) => D(row[4]));
  const sma20 =
    closes.length >= 20
      ? asFixed(closes.slice(-20).reduce((acc, v) => acc.plus(v), D(0)).div(20))
      : null;
  const lastVsSma20Bps =
    sma20 === null
      ? null
      : asFixed(D(ticker.lastPrice).minus(sma20).div(sma20).times(10_000).toDecimalPlaces(4));

  return {
    asOf: new Date(fetchedAtMs).toISOString(),
    fetchedAtMs,
    symbol,
    status: filters.status,
    last: ticker.lastPrice,
    bid: book.bid,
    ask: book.ask,
    mid: book.mid,
    spreadBps: book.spreadBps,
    change24hPct: ticker.priceChangePercent,
    high24h: ticker.highPrice,
    low24h: ticker.lowPrice,
    volumeBase: ticker.volume,
    volumeQuote: ticker.quoteVolume,
    book: {
      lastUpdateId: book.lastUpdateId,
      bids: book.bids,
      asks: book.asks,
      bidQtyTop: book.bidQtyTop,
      askQtyTop: book.askQtyTop,
      imbalance: book.imbalance,
    },
    sma20_1h: sma20,
    lastVsSma20Bps,
    filters,
    sources: SOURCE,
  };
}

export function levelsFromBook(rows: [string, string][]): BookLevel[] {
  return rows.map(([price, qty]) => ({ price, qty }));
}

export function summarizeBook(
  bids: BookLevel[],
  asks: BookLevel[],
  lastUpdateId: number,
): Observation["book"] & { bid: string; ask: string; mid: string; spreadBps: string } {
  const bid = bids[0]?.price ?? "0";
  const ask = asks[0]?.price ?? "0";
  const mid = D(bid).plus(ask).eq(0) ? D(0) : D(bid).plus(ask).div(2);
  const spreadBps = mid.eq(0) ? D(0) : D(ask).minus(bid).div(mid).times(10_000).toDecimalPlaces(6);
  const bidQtyTop = sumQty(bids.slice(0, 10));
  const askQtyTop = sumQty(asks.slice(0, 10));
  const denom = D(bidQtyTop).plus(askQtyTop);
  const imbalance = denom.eq(0) ? D(0) : D(bidQtyTop).minus(askQtyTop).div(denom).toDecimalPlaces(6);
  return {
    lastUpdateId,
    bids,
    asks,
    bidQtyTop,
    askQtyTop,
    imbalance: asFixed(imbalance),
    bid,
    ask,
    mid: asFixed(mid),
    spreadBps: asFixed(spreadBps),
  };
}

export async function fetchQuote(symbolRaw: string) {
  const symbol = normalizeSymbol(symbolRaw);
  const fetchedAtMs = Date.now();
  const [ticker, depth] = await Promise.all([fetchTicker(symbol), fetchDepth(symbol, 20)]);
  const book = summarizeBook(levelsFromBook(depth.bids), levelsFromBook(depth.asks), depth.lastUpdateId);
  return {
    asOf: new Date(fetchedAtMs).toISOString(),
    fetchedAtMs,
    symbol,
    last: ticker.lastPrice,
    bid: book.bid,
    ask: book.ask,
    mid: book.mid,
    spreadBps: book.spreadBps,
    change24hPct: ticker.priceChangePercent,
    high24h: ticker.highPrice,
    low24h: ticker.lowPrice,
    volumeQuote: ticker.quoteVolume,
    book,
    source: "binance-spot-public ticker+depth",
  };
}

function sumQty(levels: BookLevel[]): string {
  return asFixed(levels.reduce((acc, level) => acc.plus(level.qty), D(0)));
}

function parseFilters(info: ExchangeInfo["symbols"][0]): SymbolFilters {
  const map = new Map(info.filters.map((f) => [f.filterType, f]));
  const price = map.get("PRICE_FILTER");
  const lot = map.get("LOT_SIZE");
  const notional = map.get("NOTIONAL") ?? map.get("MIN_NOTIONAL");
  if (!price || !lot || !notional) {
    throw new BossError("FILTERS", `Incomplete Spot filters for ${info.symbol}.`);
  }
  return {
    status: info.status,
    baseAsset: info.baseAsset,
    quoteAsset: info.quoteAsset,
    tickSize: price.tickSize ?? "0",
    minPrice: price.minPrice ?? "0",
    maxPrice: price.maxPrice ?? "0",
    stepSize: lot.stepSize ?? "0",
    minQty: lot.minQty ?? "0",
    maxQty: lot.maxQty ?? "0",
    minNotional: notional.minNotional ?? "0",
    maxNotional: notional.maxNotional ?? null,
  };
}
