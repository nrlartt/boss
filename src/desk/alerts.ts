import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.ts";
import { BossError } from "../lib/errors.ts";
import { D } from "../lib/money.ts";
import { normalizeSymbol } from "../market/binance.ts";

export type PriceAlert = {
  id: string;
  symbol: string;
  direction: "above" | "below";
  price: string;
  note: string;
  createdAt: string;
  triggeredAt: string | null;
  active: boolean;
};

type AlertFile = { alerts: PriceAlert[] };

const MAX_ALERTS = 64;
let cache: PriceAlert[] | null = null;
const listeners = new Set<(event: PriceAlert) => void>();

function alertPath(): string {
  mkdirSync(config.dataDir, { recursive: true });
  return path.join(config.dataDir, "alerts.json");
}

function load(): PriceAlert[] {
  if (cache) return cache;
  const file = alertPath();
  if (!existsSync(file)) {
    cache = [];
    return cache;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as AlertFile;
    cache = parsed.alerts ?? [];
  } catch {
    cache = [];
  }
  return cache;
}

function persist(rows: PriceAlert[]): void {
  cache = rows;
  writeFileSync(alertPath(), JSON.stringify({ alerts: rows }, null, 2));
}

export function listAlerts(): { active: PriceAlert[]; triggered: PriceAlert[] } {
  const rows = load();
  return {
    active: rows.filter((row) => row.active),
    triggered: rows.filter((row) => !row.active && row.triggeredAt).slice(0, 30),
  };
}

export function createAlert(input: {
  symbol: string;
  direction: "above" | "below";
  price: string;
  note?: string;
}): PriceAlert {
  const symbol = normalizeSymbol(input.symbol);
  const price = input.price.trim();
  if (!price || !Number.isFinite(Number(price)) || Number(price) <= 0) {
    throw new BossError("ALERT", "Alert price must be a positive number.");
  }
  const rows = load();
  if (rows.filter((row) => row.active).length >= MAX_ALERTS) {
    throw new BossError("ALERT", `At most ${MAX_ALERTS} active alerts.`);
  }
  const alert: PriceAlert = {
    id: `alert_${randomUUID().slice(0, 10)}`,
    symbol,
    direction: input.direction,
    price,
    note: input.note?.trim() || "",
    createdAt: new Date().toISOString(),
    triggeredAt: null,
    active: true,
  };
  rows.unshift(alert);
  persist(rows);
  return alert;
}

export function deleteAlert(id: string): void {
  const rows = load().filter((row) => row.id !== id);
  persist(rows);
}

export function onAlertTriggered(cb: (event: PriceAlert) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function checkAlerts(symbol: string, last: string): PriceAlert[] {
  const price = D(last);
  if (!price.gt(0)) return [];
  const fired: PriceAlert[] = [];
  const rows = load();
  let changed = false;
  for (const row of rows) {
    if (!row.active || row.symbol !== symbol) continue;
    const target = D(row.price);
    const hit =
      row.direction === "above" ? price.gte(target) : price.lte(target);
    if (!hit) continue;
    row.active = false;
    row.triggeredAt = new Date().toISOString();
    fired.push({ ...row });
    changed = true;
    for (const cb of listeners) cb(row);
  }
  if (changed) persist(rows);
  return fired;
}

export function symbolsWithActiveAlerts(): string[] {
  return [...new Set(load().filter((row) => row.active).map((row) => row.symbol))];
}
