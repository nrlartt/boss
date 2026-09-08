import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.ts";
import { sha256Json } from "../lib/hash.ts";
import type { Plan, Receipt, Verdict } from "../types.ts";

function dir(): string {
  const folder = path.join(config.dataDir, "receipts");
  mkdirSync(folder, { recursive: true });
  return folder;
}

function chainFile(): string {
  return path.join(config.dataDir, "chain.json");
}

export function dailyNotionalUsed(): string {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const startMs = start.getTime();
  let sum = 0;
  for (const receipt of listReceipts()) {
    if (Date.parse(receipt.createdAt) < startMs) continue;
    if (receipt.execution.status !== "sent") continue;
    if (receipt.order) sum += Number(receipt.order.notional);
  }
  return sum.toFixed(8);
}

export function verifyReceiptChain(): { ok: boolean; count: number; head: string | null; error?: string } {
  if (!existsSync(path.join(config.dataDir, "receipts"))) {
    return { ok: true, count: 0, head: readHead() };
  }
  const rows = listReceipts().slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!rows.length) return { ok: true, count: 0, head: readHead() };
  let prev: string | null = null;
  for (const row of rows) {
    if (row.previousHash !== prev) {
      return {
        ok: false,
        count: rows.length,
        head: null,
        error: `Receipt chain break at ${row.id}: previousHash does not match.`,
      };
    }
    prev = row.hash;
  }
  const stored = readHead();
  if (stored && stored !== prev) {
    return {
      ok: false,
      count: rows.length,
      head: stored,
      error: "chain.json head does not match the last receipt hash.",
    };
  }
  return { ok: true, count: rows.length, head: prev };
}

export function writeReceipt(input: {
  stage: Receipt["stage"];
  verdict: Verdict;
  plan: Plan;
  summary: string;
  execution?: Receipt["execution"];
  packet?: Receipt["packet"];
}): Receipt {
  const previousHash = readHead();
  const createdAt = new Date().toISOString();
  const draft = {
    id: `rcpt_${randomUUID().slice(0, 12)}`,
    createdAt,
    stage: input.stage,
    verdict: input.verdict,
    planId: input.plan.id,
    planHash: input.plan.planHash,
    previousHash,
    intent: input.plan.intent,
    order: input.plan.order,
    policy: input.plan.policy,
    summary: input.summary,
    execution: input.execution ?? {
      venue: "none" as const,
      status: "not-sent" as const,
      orderId: null,
      clientOrderId: null,
      raw: null,
    },
    packet: input.packet ?? null,
  };
  const hash = sha256Json({ ...draft, hash: null });
  const receipt: Receipt = { ...draft, hash };
  writeFileSync(path.join(dir(), `${receipt.id}.json`), JSON.stringify(receipt, null, 2));
  writeFileSync(chainFile(), JSON.stringify({ head: hash, lastId: receipt.id }, null, 2));
  return receipt;
}

export function listReceipts(): Receipt[] {
  if (!existsSync(dir())) return [];
  return readdirSync(dir())
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(path.join(dir(), name), "utf8")) as Receipt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getReceipt(id: string): Receipt | null {
  const file = path.join(dir(), `${id}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as Receipt;
}

function readHead(): string | null {
  if (!existsSync(chainFile())) return null;
  const parsed = JSON.parse(readFileSync(chainFile(), "utf8")) as { head?: string };
  return parsed.head ?? null;
}
