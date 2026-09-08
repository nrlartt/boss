export type Side = "BUY" | "SELL";
export type OrderType = "LIMIT" | "MARKET";
export type RuleStatus = "PASS" | "FAIL" | "UNKNOWN";
export type Verdict = "BLOCK" | "UNKNOWN" | "CLEAR";
export type EvidenceMode = "LIVE" | "HOST_OBSERVED" | "ABSENT";

export type SymbolFilters = {
  status: string;
  baseAsset: string;
  quoteAsset: string;
  tickSize: string;
  minPrice: string;
  maxPrice: string;
  stepSize: string;
  minQty: string;
  maxQty: string;
  minNotional: string;
  maxNotional: string | null;
};

export type BookLevel = { price: string; qty: string };

export type Observation = {
  asOf: string;
  fetchedAtMs: number;
  symbol: string;
  status: string;
  last: string;
  bid: string;
  ask: string;
  mid: string;
  spreadBps: string;
  change24hPct: string;
  high24h: string;
  low24h: string;
  volumeBase: string;
  volumeQuote: string;
  book: {
    lastUpdateId: number;
    bids: BookLevel[];
    asks: BookLevel[];
    bidQtyTop: string;
    askQtyTop: string;
    imbalance: string;
  };
  sma20_1h: string | null;
  lastVsSma20Bps: string | null;
  filters: SymbolFilters;
  sources: {
    ticker: string;
    depth: string;
    klines: string;
    exchangeInfo: string;
  };
};

export type SignalRow = {
  symbol: string;
  price: string | null;
  changePct: string | null;
  extra: string;
};

export type SignalBoard = {
  asOf: string;
  trending: SignalRow[];
  smartMoney: SignalRow[];
  symbolHits: { trending: SignalRow | null; smartMoney: SignalRow | null };
  sources: { trending: string; smartMoney: string };
};

export type NewsItem = {
  title: string;
  url: string;
  publishedAt: string;
  source: string;
};

export type AnalysisReport = {
  asOf: string;
  symbol: string;
  baseAsset: string;
  summary: {
    headline: string;
    bias: "bullish" | "bearish" | "neutral";
    confidence: "low" | "medium" | "high";
    score: number;
  };
  technical: {
    last: string;
    change24hPct: string;
    rangePositionPct: number;
    sma20_1h: string | null;
    lastVsSma20Bps: string | null;
    rsi14_1h: number | null;
    spreadBps: string;
    bookImbalance: string;
    volumeQuote24h: string;
    trendLabel: "up" | "down" | "flat";
    findings: string[];
  };
  trend: {
    onTrendingBoard: boolean;
    onSmartMoneyBoard: boolean;
    trendingRank: number | null;
    tapeRank: number | null;
    socialPulse: string;
    findings: string[];
  };
  news: {
    asOf: string;
    source: string;
    items: NewsItem[];
    unavailable?: string;
  };
  actions: string[];
  disclaimer: string;
  web3Pulse: {
    asOf: string;
    trending: SignalRow[];
    smartMoney: SignalRow[];
    symbolHits: { trending: SignalRow | null; smartMoney: SignalRow | null };
    macro: {
      fearGreed: number | null;
      fearGreedLabel: string;
      googleNewsCount: number;
      coingeckoTrending: boolean;
      redditMentions: number;
      source: string;
      summary: string;
    };
  };
};

export type AccountSnapshot = {
  mode: EvidenceMode;
  capturedAt: string;
  balances: { asset: string; free: string }[];
  source: string;
};

export type Intent = {
  raw: string;
  action: "observe" | "plan";
  symbol: string;
  side: Side | null;
  orderType: OrderType;
  quoteQty: string | null;
  baseQty: string | null;
  limitPrice: string | null;
};

export type Mandate = {
  version: 1;
  product: "SPOT";
  killSwitch: boolean;
  allowedSides: Side[];
  allowedOrderTypes: OrderType[];
  maxNotionalUsdt: string;
  maxDailyNotionalUsdt: string;
  maxPriceDeviationBps: string;
  maxSpreadBps: string;
  maxEvidenceAgeMs: number;
  approvalTtlMs: number;
  requireApproval: boolean;
  minBookCoverage: string;
  symbolAllowlist: string[];
};

export type RuleResult = {
  id: string;
  status: RuleStatus;
  detail: string;
};

export type PolicyResult = {
  verdict: Verdict;
  rules: RuleResult[];
  failCount: number;
  unknownCount: number;
  passCount: number;
};

export type Plan = {
  id: string;
  createdAt: string;
  intent: Intent;
  observation: Observation;
  signals: SignalBoard;
  account: AccountSnapshot | null;
  order: {
    symbol: string;
    side: Side;
    type: OrderType;
    timeInForce: "GTC" | null;
    quantity: string;
    price: string | null;
    quoteSpend: string;
    notional: string;
  };
  planHash: string;
  policy: PolicyResult;
  notes: string[];
};

export type Approval = {
  id: string;
  planId: string;
  planHash: string;
  createdAt: string;
  expiresAt: string;
  used: boolean;
};

export type Receipt = {
  id: string;
  createdAt: string;
  stage: "PREVIEW" | "APPROVED" | "SENT" | "BLOCKED" | "UNSENT";
  verdict: Verdict;
  planId: string;
  planHash: string;
  previousHash: string | null;
  hash: string;
  summary: string;
  intent: Intent;
  order: Plan["order"] | null;
  policy: PolicyResult;
  execution: {
    venue: "none" | "agent-os-mcp" | "direct-api";
    status: "not-sent" | "sent" | "rejected";
    orderId: string | null;
    clientOrderId: string | null;
    raw: unknown;
  };
  packet: ExecutionPacket | null;
};

export type ExecutionPacket = {
  venue: "binance-spot";
  via: "agent-os-mcp";
  instruction: string;
  params: {
    symbol: string;
    side: Side;
    type: OrderType;
    timeInForce: "GTC" | undefined;
    quantity: string;
    price: string | undefined;
    newClientOrderId: string;
  };
  approvalId: string;
  planId: string;
  planHash: string;
  expiresAt: string;
};
