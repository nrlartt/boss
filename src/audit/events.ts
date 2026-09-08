import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "../config.ts";
import { appendJsonl } from "../lib/fsyncJsonl.ts";
import { burnScope, loadScope } from "./scope.ts";
import { classifyObservedOrder } from "./classify.ts";
import { listAuthorizations } from "./authorizations.ts";
import type { AuditEvent, ObservedOrder, StampOutcome } from "./types.ts";

const seen = new Set<string>();
let eventsLoaded = false;
const events: AuditEvent[] = [];

export function listAuditEvents(): AuditEvent[] {
  hydrate();
  return [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function auditCounters(): Record<StampOutcome, number> & { stamps: number } {
  hydrate();
  const counters: Record<StampOutcome, number> & { stamps: number } = {
    AUTHORISED: 0,
    MISMATCHED: 0,
    FOREIGN: 0,
    FORGED: 0,
    UNKNOWN_AUTHENTIC: 0,
    stamps: listAuthorizations().length,
  };
  for (const event of events) counters[event.outcome] += 1;
  return counters;
}

export function auditSeries(): { t: string; outcome: StampOutcome }[] {
  return listAuditEvents()
    .slice()
    .reverse()
    .map((event) => ({ t: event.createdAt, outcome: event.outcome }));
}

export function ingestObservedOrder(order: ObservedOrder): AuditEvent | null {
  hydrate();
  if (!order.orderId) return null;
  if (seen.has(order.orderId)) return null;
  const classified = classifyObservedOrder(order);
  const event: AuditEvent = {
    id: `aud_${randomUUID().slice(0, 12)}`,
    createdAt: new Date().toISOString(),
    ...classified,
  };
  events.push(event);
  seen.add(order.orderId);
  persistSeen();
  appendJsonl(eventsFile(), event);
  if (event.outcome !== "AUTHORISED") {
    burnScope(`${event.outcome}: ${event.explanation}`, event.id);
  }
  return event;
}

function hydrate(): void {
  if (eventsLoaded) return;
  eventsLoaded = true;
  if (existsSync(eventsFile())) {
    for (const line of readFileSync(eventsFile(), "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as AuditEvent;
      events.push(event);
      if (event.orderId) seen.add(event.orderId);
    }
  }
  if (existsSync(seenFile())) {
    const ids = JSON.parse(readFileSync(seenFile(), "utf8")) as string[];
    for (const id of ids) seen.add(id);
  }
  void loadScope();
}

function persistSeen(): void {
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(seenFile(), JSON.stringify([...seen], null, 2));
}

function eventsFile(): string {
  return path.join(config.dataDir, "audit-events.jsonl");
}

function seenFile(): string {
  return path.join(config.dataDir, "seen-orders.json");
}
