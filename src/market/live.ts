import type { IncomingMessage, ServerResponse } from "node:http";
import { fetchQuote, levelsFromBook, summarizeBook } from "./binance.ts";
import { TAPE_SYMBOLS, mergeTapeSymbols } from "./symbols.ts";
import { config } from "../config.ts";
import { checkAlerts } from "../desk/alerts.ts";
import type { BookLevel } from "../types.ts";

type TapeRow = {
  symbol: string;
  last: string;
  changePct: string;
  high: string;
  low: string;
};

type LiveQuote = Awaited<ReturnType<typeof fetchQuote>>;

type Client = { res: ServerResponse; symbol: string };

const clients = new Set<Client>();
const tape = new Map<string, TapeRow>();
const books = new Map<string, { lastUpdateId: number; bids: BookLevel[]; asks: BookLevel[] }>();
const quotes = new Map<string, LiveQuote>();
const TAPE_LIST = mergeTapeSymbols(config.watchSymbols);
const watched = new Set<string>(TAPE_LIST);

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let restTimer: ReturnType<typeof setInterval> | null = null;
let started = false;
const SPARK_MAX = 48;
const sparks = new Map<string, number[]>();

export function watchSymbol(symbol: string): void {
  const next = symbol.toUpperCase();
  if (watched.has(next)) return;
  watched.add(next);
  reconnect();
}

export function attachLive(req: IncomingMessage, res: ServerResponse, symbol: string): void {
  startLive();
  watchSymbol(symbol);
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
  });
  res.write(":\n\n");
  const client: Client = { res, symbol: symbol.toUpperCase() };
  clients.add(client);
  res.write(`data: ${JSON.stringify(snapshot(client.symbol))}\n\n`);
  req.on("close", () => clients.delete(client));
}

export function sparkHistory(): Record<string, number[]> {
  return Object.fromEntries([...sparks.entries()].map(([symbol, values]) => [symbol, [...values]]));
}

function pushSpark(symbol: string, last: string): void {
  const value = Number(last);
  if (!Number.isFinite(value) || value <= 0) return;
  const series = sparks.get(symbol) ?? [];
  const prev = series[series.length - 1];
  if (prev === value) return;
  series.push(value);
  if (series.length > SPARK_MAX) series.shift();
  sparks.set(symbol, series);
}

export function snapshot(symbol: string) {
  const quote = quotes.get(symbol) ?? null;
  return {
    asOf: new Date().toISOString(),
    source: socket && socket.readyState === WebSocket.OPEN ? "binance-spot-ws" : "binance-spot-public",
    tape: TAPE_LIST.map((row) => tape.get(row)).filter(Boolean),
    sparks: sparkHistory(),
    quote,
  };
}

function startLive(): void {
  if (started) return;
  started = true;
  connect();
  void seedRest();
  restTimer = setInterval(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN) void seedRest();
  }, 2000);
}

function streamUrl(): string {
  const parts = [...watched].flatMap((symbol) => {
    const id = symbol.toLowerCase();
    return [`${id}@ticker`, `${id}@depth20@100ms`];
  });
  return `wss://stream.binance.com:9443/stream?streams=${parts.join("/")}`;
}

function connect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
  const next = new WebSocket(streamUrl());
  socket = next;
  next.onmessage = (event) => {
    try {
      const payload = JSON.parse(String(event.data)) as {
        stream?: string;
        data?: Record<string, unknown>;
      };
      if (!payload.stream || !payload.data) return;
      const symbol = payload.stream.split("@")[0]?.toUpperCase() ?? "";
      if (!symbol) return;
      if (payload.stream.endsWith("@ticker")) applyTicker(payload.data);
      if (payload.stream.includes("@depth20")) applyDepth(symbol, payload.data);
      scheduleFlush();
    } catch {
      // Ignore a single malformed frame.
    }
  };
  next.onclose = () => {
    if (socket === next) socket = null;
    reconnectTimer = setTimeout(connect, 1500);
  };
  next.onerror = () => {
    next.close();
  };
}

function reconnect(): void {
  if (!started) return;
  connect();
}

function applyTicker(data: Record<string, unknown>): void {
  const symbol = String(data.s ?? "");
  if (!symbol) return;
  const row: TapeRow = {
    symbol,
    last: String(data.c ?? ""),
    changePct: String(data.P ?? ""),
    high: String(data.h ?? ""),
    low: String(data.l ?? ""),
  };
  tape.set(symbol, row);
  pushSpark(symbol, row.last);
  checkAlerts(symbol, row.last);
  const book = books.get(symbol);
  const summarized = book
    ? summarizeBook(book.bids, book.asks, book.lastUpdateId)
    : summarizeBook(
        [{ price: String(data.b ?? row.last), qty: "0" }],
        [{ price: String(data.a ?? row.last), qty: "0" }],
        0,
      );
  quotes.set(symbol, {
    asOf: new Date().toISOString(),
    fetchedAtMs: Date.now(),
    symbol,
    last: row.last,
    bid: summarized.bid,
    ask: summarized.ask,
    mid: summarized.mid,
    spreadBps: summarized.spreadBps,
    change24hPct: row.changePct,
    high24h: row.high,
    low24h: row.low,
    volumeQuote: String(data.q ?? ""),
    book: summarized,
    source: "binance-spot-ws @ticker/@depth20",
  });
}

function applyDepth(symbol: string, data: Record<string, unknown>): void {
  const bids = levelsFromBook((data.bids as [string, string][]) ?? []);
  const asks = levelsFromBook((data.asks as [string, string][]) ?? []);
  const lastUpdateId = Number(data.lastUpdateId ?? 0);
  books.set(symbol, { lastUpdateId, bids, asks });
  const prev = quotes.get(symbol);
  if (!prev) return;
  const summarized = summarizeBook(bids, asks, lastUpdateId);
  quotes.set(symbol, {
    ...prev,
    asOf: new Date().toISOString(),
    fetchedAtMs: Date.now(),
    bid: summarized.bid,
    ask: summarized.ask,
    mid: summarized.mid,
    spreadBps: summarized.spreadBps,
    book: summarized,
    source: "binance-spot-ws @ticker/@depth20",
  });
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    for (const client of clients) {
      try {
        client.res.write(`data: ${JSON.stringify(snapshot(client.symbol))}\n\n`);
      } catch {
        clients.delete(client);
      }
    }
  }, 200);
}

async function seedRest(): Promise<void> {
  await Promise.all(
    [...watched].map(async (symbol) => {
      try {
        const quote = await fetchQuote(symbol);
        quotes.set(symbol, quote);
        tape.set(symbol, {
          symbol,
          last: quote.last,
          changePct: quote.change24hPct,
          high: quote.high24h,
          low: quote.low24h,
        });
        pushSpark(symbol, quote.last);
        checkAlerts(symbol, quote.last);
        books.set(symbol, {
          lastUpdateId: quote.book.lastUpdateId,
          bids: quote.book.bids,
          asks: quote.book.asks,
        });
      } catch {
        // Keep last good snapshot.
      }
    }),
  );
  scheduleFlush();
}
