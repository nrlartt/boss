import { postJson } from "../lib/http.ts";
import { normalizeSymbol } from "./binance.ts";
import type { SignalBoard, SignalRow } from "../types.ts";

const TRENDING_URL =
  "https://web3.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/pulse/unified/rank/list/ai";
const INFLOW_URL =
  "https://web3.binance.com/bapi/defi/v1/public/wallet-direct/tracker/wallet/token/inflow/rank/query/ai";

type RankResponse = {
  code?: string;
  data?: { tokens?: RankToken[] } | RankToken[];
};

type RankToken = {
  symbol?: string;
  tokenName?: string;
  price?: string;
  percentChange24h?: string;
  priceChangeRate?: string;
  percentChange?: string;
  inflow?: number;
  volume?: string;
};

export async function fetchSignalBoard(symbolRaw: string): Promise<SignalBoard> {
  const symbol = normalizeSymbol(symbolRaw);
  const asOf = new Date().toISOString();
  const [trendingRaw, inflowRaw] = await Promise.allSettled([
    postJson<RankResponse>(TRENDING_URL, {
      rankType: 10,
      chainId: "56",
      period: 50,
      page: 1,
      size: 12,
      countMin: 10,
      launchTimeMin: 15,
      liquidityMin: 5000,
      uniqueTraderMin: 10,
      volumeMin: 10000,
      tagFilter: [1, 2, 3],
    }),
    postJson<RankResponse>(INFLOW_URL, { chainId: "56", period: "24h", tagType: 2 }),
  ]);

  const trending = trendingRaw.status === "fulfilled" ? mapTrending(trendingRaw.value) : [];
  const smartMoney = inflowRaw.status === "fulfilled" ? mapInflow(inflowRaw.value) : [];

  return {
    asOf,
    trending,
    smartMoney,
    symbolHits: {
      trending: findHit(trending, symbol),
      smartMoney: findHit(smartMoney, symbol),
    },
    sources: {
      trending: TRENDING_URL,
      smartMoney: INFLOW_URL,
    },
  };
}

function mapTrending(payload: RankResponse): SignalRow[] {
  if (payload.code && payload.code !== "000000") return [];
  const tokens = Array.isArray(payload.data) ? payload.data : payload.data?.tokens ?? [];
  return tokens.slice(0, 10).map((row) => ({
    symbol: String(row.symbol ?? "").toUpperCase(),
    price: row.price ?? null,
    changePct: row.percentChange24h ?? row.percentChange ?? null,
    extra: "trending 24h BSC",
  }));
}

function mapInflow(payload: RankResponse): SignalRow[] {
  if (payload.code && payload.code !== "000000") return [];
  const rows = Array.isArray(payload.data) ? payload.data : [];
  return rows.slice(0, 10).map((row) => ({
    symbol: String(row.tokenName ?? row.symbol ?? "").toUpperCase(),
    price: row.price ?? null,
    changePct: row.priceChangeRate ?? null,
    extra: `smart-money inflow ${row.inflow ?? "n/a"} USD`,
  }));
}

function findHit(rows: SignalRow[], symbol: string): SignalRow | null {
  const base = symbol.replace(/USDT|USDC|FDUSD$/i, "");
  return (
    rows.find((row) => row.symbol === base || row.symbol === symbol || row.symbol.startsWith(base)) ??
    null
  );
}

