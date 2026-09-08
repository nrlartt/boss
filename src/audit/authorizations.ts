import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { config } from "../config.ts";
import { hmacSecret } from "../stamp/secret.ts";
import { mintClientOrderId } from "../stamp/clientOrderId.ts";
import { appendJsonl } from "../lib/fsyncJsonl.ts";
import { mandateHash } from "../policy/mandate.ts";
import type { Authorization } from "./types.ts";
import type { Plan } from "../types.ts";

type SeqFile = { next: number };

const auths = new Map<number, Authorization>();
const byApproval = new Map<string, Authorization>();
const byClient = new Map<string, Authorization>();
let loaded = false;

export function listAuthorizations(): Authorization[] {
  hydrate();
  return [...auths.values()].sort((a, b) => b.seq - a.seq);
}

export function getAuthorizationBySeq(seq: number): Authorization | null {
  hydrate();
  return auths.get(seq) ?? null;
}

export function getAuthorizationByApproval(approvalId: string): Authorization | null {
  hydrate();
  return byApproval.get(approvalId) ?? null;
}

export function getAuthorizationByClientId(clientOrderId: string): Authorization | null {
  hydrate();
  return byClient.get(clientOrderId) ?? null;
}

export function issueAuthorization(plan: Plan, approvalId: string): Authorization {
  hydrate();
  const existing = byApproval.get(approvalId);
  if (existing) return existing;
  const hash = mandateHash();
  const seq = takeSeq();
  const clientOrderId = mintClientOrderId(seq, hash, hmacSecret());
  const row: Authorization = {
    seq,
    clientOrderId,
    mandateHash: hash,
    planId: plan.id,
    planHash: plan.planHash,
    approvalId,
    symbol: plan.order.symbol,
    side: plan.order.side,
    type: plan.order.type,
    quantity: plan.order.quantity,
    price: plan.order.price,
    createdAt: new Date().toISOString(),
  };
  remember(row);
  appendJsonl(authFile(), row);
  return row;
}

function hydrate(): void {
  if (loaded) return;
  loaded = true;
  const file = authFile();
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    remember(JSON.parse(line) as Authorization);
  }
}

function remember(row: Authorization): void {
  auths.set(row.seq, row);
  byApproval.set(row.approvalId, row);
  byClient.set(row.clientOrderId, row);
}

function takeSeq(): number {
  mkdirSync(config.dataDir, { recursive: true });
  const file = seqFile();
  const current: SeqFile = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as SeqFile)
    : { next: 1 };
  const seq = current.next;
  writeFileSync(file, JSON.stringify({ next: seq + 1 }, null, 2));
  return seq;
}

function authFile(): string {
  return path.join(config.dataDir, "authorizations.jsonl");
}

function seqFile(): string {
  return path.join(config.dataDir, "stamp-seq.json");
}
