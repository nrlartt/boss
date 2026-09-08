import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { config } from "../config.ts";
import type { TradeScope } from "./types.ts";

const OPEN: TradeScope = {
  status: "open",
  reason: null,
  findingId: null,
  burnedAt: null,
};

export function loadScope(): TradeScope {
  const file = scopeFile();
  if (!existsSync(file)) return { ...OPEN };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as TradeScope;
    if (parsed.status !== "open" && parsed.status !== "burned") return { ...OPEN };
    return {
      status: parsed.status,
      reason: parsed.reason ?? null,
      findingId: parsed.findingId ?? null,
      burnedAt: parsed.burnedAt ?? null,
    };
  } catch {
    throw new Error("Trade-scope file is unreadable.");
  }
}

export function burnScope(reason: string, findingId: string): TradeScope {
  const next: TradeScope = {
    status: "burned",
    reason,
    findingId,
    burnedAt: new Date().toISOString(),
  };
  persist(next);
  return next;
}

export function restoreScope(): TradeScope {
  persist(OPEN);
  return { ...OPEN };
}

function persist(scope: TradeScope): void {
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(scopeFile(), JSON.stringify(scope, null, 2));
}

function scopeFile(): string {
  return path.join(config.dataDir, "scope.json");
}
