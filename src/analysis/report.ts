import { fetchKlines } from "../market/binance.ts";
import { TAPE_SYMBOLS } from "../market/symbols.ts";
import type { AnalysisReport, Observation, SignalBoard } from "../types.ts";
import { buildTechnicalSnapshot, volumeQuoteLabel } from "./technicals.ts";
import { fetchResearch } from "./research.ts";

type TapeRow = { symbol: string; changePct: string; quoteVolume?: string };

export async function buildAnalysisReport(input: {
  observation: Observation;
  signals: SignalBoard;
  tape?: TapeRow[];
}): Promise<AnalysisReport> {
  const { observation, signals } = input;
  const baseAsset = observation.filters.baseAsset;
  const klines = await fetchKlines(observation.symbol, "1h", 30);
  const closes1h = klines.map((row) => row[4]);
  const technical = buildTechnicalSnapshot(observation, closes1h);
  const research = await fetchResearch(baseAsset);
  const tape = input.tape ?? [];

  const trendingRank = signals.trending.findIndex(
    (row) => row.symbol === baseAsset || row.symbol === observation.symbol.replace(/USDT$/i, ""),
  );
  const tapeSorted = [...tape].sort(
    (a, b) => Number(b.changePct) - Number(a.changePct),
  );
  const tapeRank = tapeSorted.findIndex((row) => row.symbol === observation.symbol);

  const trendFindings: string[] = [];
  if (signals.symbolHits.trending) {
    trendFindings.push(
      `${baseAsset} appears on Binance Web3 trending board (${signals.symbolHits.trending.extra}).`,
    );
  } else {
    trendFindings.push(`${baseAsset} is not on the current Web3 trending top list.`);
  }
  if (signals.symbolHits.smartMoney) {
    trendFindings.push(
      `${baseAsset} appears on the Web3 smart-money inflow board (${signals.symbolHits.smartMoney.extra}).`,
    );
  } else {
    trendFindings.push(`${baseAsset} is not on the current smart-money inflow board.`);
  }
  if (tapeRank >= 0) {
    trendFindings.push(
      `Ranks #${tapeRank + 1} by 24h change among BOSS tape symbols (${tape.length || TAPE_SYMBOLS.length} tracked).`,
    );
  }
  if (research.social.summary) {
    trendFindings.push(`Sentiment: ${research.social.summary}`);
  }
  if (research.social.fearGreed !== null) {
    trendFindings.push(`Crypto Fear & Greed index is ${research.social.fearGreed} (${research.social.fearGreedLabel}).`);
  }
  if (research.social.coingeckoTrending) {
    trendFindings.push(`${baseAsset} appears on CoinGecko trending (free public feed).`);
  }

  const score = computeScore({
    change24h: Number(observation.change24hPct),
    smaBps: observation.lastVsSma20Bps ? Number(observation.lastVsSma20Bps) : 0,
    imbalance: Number(observation.book.imbalance),
    rsi: technical.rsi14_1h,
    rangePositionPct: technical.rangePositionPct,
    onTrending: Boolean(signals.symbolHits.trending),
    onSmartMoney: Boolean(signals.symbolHits.smartMoney),
    newsCount: research.news.length,
    fearGreed: research.social.fearGreed,
    coingeckoTrending: research.social.coingeckoTrending,
  });

  const bias: AnalysisReport["summary"]["bias"] =
    score >= 18 ? "bullish" : score <= -18 ? "bearish" : "neutral";
  const confidence: AnalysisReport["summary"]["confidence"] =
    Math.abs(score) >= 35 ? "high" : Math.abs(score) >= 15 ? "medium" : "low";

  const headline = buildHeadline(observation.symbol, bias, technical.trendLabel, research.news.length);

  const actions = [
    `plan buy 5 usdt ${observation.symbol}`,
    `plan sell 0.01 ${observation.symbol.replace(/USDT$/i, "")}`,
    "Attach balances or Load API keys before expecting CLEAR.",
  ];

  return {
    asOf: new Date().toISOString(),
    symbol: observation.symbol,
    baseAsset,
    summary: { headline, bias, confidence, score },
    technical: {
      last: observation.last,
      change24hPct: observation.change24hPct,
      rangePositionPct: technical.rangePositionPct,
      sma20_1h: observation.sma20_1h,
      lastVsSma20Bps: observation.lastVsSma20Bps,
      rsi14_1h: technical.rsi14_1h,
      spreadBps: observation.spreadBps,
      bookImbalance: observation.book.imbalance,
      volumeQuote24h: volumeQuoteLabel(observation.volumeQuote),
      trendLabel: technical.trendLabel,
      findings: technical.findings,
    },
    trend: {
      onTrendingBoard: Boolean(signals.symbolHits.trending),
      onSmartMoneyBoard: Boolean(signals.symbolHits.smartMoney),
      trendingRank: trendingRank >= 0 ? trendingRank + 1 : null,
      tapeRank: tapeRank >= 0 ? tapeRank + 1 : null,
      socialPulse: research.social.summary,
      findings: trendFindings,
    },
    news: {
      asOf: research.asOf,
      source: "CoinDesk, CoinTelegraph, Decrypt, Google News RSS",
      items: research.news,
      unavailable: research.news.length ? undefined : "No matching headlines in the last RSS pull.",
    },
    actions,
    disclaimer:
      "Research summary from live market data and public feeds. Not financial advice. BOSS does not send until you type EXECUTE.",
    web3Pulse: {
      asOf: signals.asOf,
      trending: signals.trending.slice(0, 8),
      smartMoney: signals.smartMoney.slice(0, 8),
      symbolHits: signals.symbolHits,
      macro: research.social,
    },
  };
}

function computeScore(input: {
  change24h: number;
  smaBps: number;
  imbalance: number;
  rsi: number | null;
  rangePositionPct: number;
  onTrending: boolean;
  onSmartMoney: boolean;
  newsCount: number;
  fearGreed: number | null;
  coingeckoTrending: boolean;
}): number {
  let score = 0;
  score += clamp(input.change24h * 4, -25, 25);
  score += clamp(input.smaBps / 8, -20, 20);
  score += clamp(input.imbalance * 35, -15, 15);
  if (input.rsi !== null) {
    if (input.rsi > 70) score -= 8;
    else if (input.rsi < 30) score += 8;
  }
  if (input.rangePositionPct > 80) score -= 6;
  if (input.rangePositionPct < 20) score += 6;
  if (input.onTrending) score += 10;
  if (input.onSmartMoney) score += 8;
  if (input.newsCount >= 3) score += 4;
  if (input.coingeckoTrending) score += 6;
  if (input.fearGreed !== null) {
    if (input.fearGreed <= 25) score += 5;
    else if (input.fearGreed >= 75) score -= 5;
  }
  return Math.round(clamp(score, -100, 100));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildHeadline(
  symbol: string,
  bias: AnalysisReport["summary"]["bias"],
  trend: "up" | "down" | "flat",
  newsCount: number,
): string {
  const move =
    bias === "bullish"
      ? "constructive tape"
      : bias === "bearish"
        ? "soft tape"
        : "mixed tape";
  const trendWord = trend === "up" ? "24h uptrend" : trend === "down" ? "24h downtrend" : "flat 24h move";
  const newsBit = newsCount ? `${newsCount} matching headline${newsCount === 1 ? "" : "s"}` : "no fresh headlines";
  return `${symbol}: ${move} with ${trendWord}; ${newsBit}.`;
}
