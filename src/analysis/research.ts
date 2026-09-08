import { config } from "../config.ts";
import type { NewsItem } from "../types.ts";

const RSS_FEEDS = [
  { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { name: "CoinTelegraph", url: "https://cointelegraph.com/rss" },
  { name: "Decrypt", url: "https://decrypt.co/feed" },
];

const KEYWORDS: Record<string, string[]> = {
  BTC: ["bitcoin", "btc", "satoshi"],
  ETH: ["ethereum", "eth", "ether"],
  BNB: ["bnb", "binance coin", "binance"],
  SOL: ["solana", "sol"],
  XRP: ["xrp", "ripple"],
  DOGE: ["dogecoin", "doge"],
  ADA: ["cardano", "ada"],
  AVAX: ["avalanche", "avax"],
  LINK: ["chainlink", "link"],
  TRX: ["tron", "trx"],
  DOT: ["polkadot", "dot"],
  POL: ["polygon", "pol", "matic"],
  LTC: ["litecoin", "ltc"],
  UNI: ["uniswap", "uni"],
  ATOM: ["cosmos", "atom"],
  NEAR: ["near protocol", "near"],
  APT: ["aptos", "apt"],
  ARB: ["arbitrum", "arb"],
  OP: ["optimism", " op "],
  SUI: ["sui", "sui network"],
};

export type SocialPulse = {
  fearGreed: number | null;
  fearGreedLabel: string;
  googleNewsCount: number;
  coingeckoTrending: boolean;
  redditMentions: number;
  source: string;
  summary: string;
  unavailable?: string;
};

export type ResearchBundle = {
  asOf: string;
  news: NewsItem[];
  social: SocialPulse;
};

export async function fetchResearch(baseAsset: string): Promise<ResearchBundle> {
  const asOf = new Date().toISOString();
  const [news, social] = await Promise.all([fetchNews(baseAsset), fetchSocialPulse(baseAsset)]);
  return { asOf, news, social };
}

async function fetchNews(baseAsset: string): Promise<NewsItem[]> {
  const terms = keywordsFor(baseAsset);
  const googleQuery = encodeURIComponent(`${terms[0]} crypto`);
  const googleUrl = `https://news.google.com/rss/search?q=${googleQuery}&hl=en-US&gl=US&ceid=US:en`;
  const batches = await Promise.allSettled([
    ...RSS_FEEDS.map((feed) => fetchRss(feed.name, feed.url, terms)),
    fetchRss("Google News", googleUrl, terms),
  ]);
  const merged = batches
    .flatMap((row) => (row.status === "fulfilled" ? row.value : []))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const seen = new Set<string>();
  const unique: NewsItem[] = [];
  for (const item of merged) {
    const key = item.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
    if (unique.length >= 10) break;
  }
  return unique;
}

async function fetchSocialPulse(baseAsset: string): Promise<SocialPulse> {
  const terms = keywordsFor(baseAsset);
  const [fng, googleNews, gecko, reddit] = await Promise.allSettled([
    fetchFearGreed(),
    fetchGoogleNewsCount(baseAsset, terms),
    fetchCoinGeckoTrending(baseAsset),
    fetchRedditMentions(terms[0] ?? baseAsset.toLowerCase()),
  ]);

  const fear = fng.status === "fulfilled" ? fng.value : { value: null, label: "unknown" };
  const googleNewsCount = googleNews.status === "fulfilled" ? googleNews.value : 0;
  const coingeckoTrending = gecko.status === "fulfilled" ? gecko.value : false;
  const redditMentions = reddit.status === "fulfilled" ? reddit.value : 0;

  const parts: string[] = [];
  if (fear.value !== null) parts.push(`Fear & Greed ${fear.value} (${fear.label})`);
  if (googleNewsCount) parts.push(`${googleNewsCount} Google News hits`);
  if (coingeckoTrending) parts.push("CoinGecko trending");
  if (redditMentions) parts.push(`${redditMentions} Reddit r/CryptoCurrency posts`);

  return {
    fearGreed: fear.value,
    fearGreedLabel: fear.label,
    googleNewsCount,
    coingeckoTrending,
    redditMentions,
    source: "alternative.me · Google News RSS · CoinGecko · Reddit RSS",
    summary: parts.length ? parts.join(" · ") : "Public sentiment feeds returned no extra signal.",
  };
}

async function fetchFearGreed(): Promise<{ value: number | null; label: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=1", {
      signal: ctrl.signal,
      headers: { accept: "application/json", "user-agent": config.userAgent },
    });
    const data = (await res.json()) as { data?: Array<{ value: string; value_classification: string }> };
    const row = data.data?.[0];
    if (!row) return { value: null, label: "unknown" };
    return { value: Number(row.value), label: row.value_classification.toLowerCase() };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGoogleNewsCount(baseAsset: string, terms: string[]): Promise<number> {
  const q = encodeURIComponent(`${terms[0]} ${baseAsset} crypto`);
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
  const rows = await fetchRss("Google News", url, terms);
  return rows.length;
}

async function fetchCoinGeckoTrending(baseAsset: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/search/trending", {
      signal: ctrl.signal,
      headers: { accept: "application/json", "user-agent": config.userAgent },
    });
    const data = (await res.json()) as {
      coins?: Array<{ item?: { symbol?: string; name?: string } }>;
    };
    const base = baseAsset.toLowerCase();
    return (data.coins ?? []).some((row) => {
      const sym = String(row.item?.symbol ?? "").toLowerCase();
      const name = String(row.item?.name ?? "").toLowerCase();
      return sym === base || name.includes(base);
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRedditMentions(term: string): Promise<number> {
  const url = `https://www.reddit.com/r/CryptoCurrency/search.rss?q=${encodeURIComponent(term)}&restrict_sr=1&sort=new&t=day`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let text = "";
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/rss+xml", "user-agent": config.userAgent },
    });
    text = await res.text();
  } finally {
    clearTimeout(timer);
  }
  if (!text) return 0;
  return [...text.matchAll(/<item[\s\S]*?<\/item>/gi)].length;
}

async function fetchRss(source: string, url: string, terms: string[]): Promise<NewsItem[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  let text = "";
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/rss+xml, application/xml, text/xml", "user-agent": config.userAgent },
    });
    text = await res.text();
  } finally {
    clearTimeout(timer);
  }
  if (!text) return [];
  const items = [...text.matchAll(/<item[\s\S]*?<\/item>/gi)].map((match) => parseRssItem(match[0], source));
  return items.filter((row) => matchesTerms(row.title, terms));
}

function parseRssItem(block: string, source: string): NewsItem {
  const title = decodeXml(stripTags(firstTag(block, "title") ?? "Untitled"));
  const link = decodeXml(stripTags(firstTag(block, "link") ?? firstAttr(block, "link", "href") ?? ""));
  const pub = decodeXml(stripTags(firstTag(block, "pubDate") ?? firstTag(block, "published") ?? ""));
  return {
    title,
    url: link,
    publishedAt: pub ? new Date(pub).toISOString() : new Date().toISOString(),
    source,
  };
}

function keywordsFor(baseAsset: string): string[] {
  const base = baseAsset.toUpperCase();
  return KEYWORDS[base] ?? [base.toLowerCase(), `${base.toLowerCase()}usdt`];
}

function matchesTerms(title: string, terms: string[]): boolean {
  const lower = title.toLowerCase();
  return terms.some((term) => lower.includes(term.trim()));
}

function firstTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1] ?? null;
}

function firstAttr(block: string, tag: string, attr: string): string | null {
  const match = block.match(new RegExp(`<${tag}[^>]*${attr}=["']([^"']+)["']`, "i"));
  return match?.[1] ?? null;
}

function stripTags(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1").replace(/<[^>]+>/g, "").trim();
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
