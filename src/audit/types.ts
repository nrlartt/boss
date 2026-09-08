import type { OrderType, Side } from "../types.ts";

export type StampOutcome = "AUTHORISED" | "MISMATCHED" | "FOREIGN" | "FORGED" | "UNKNOWN_AUTHENTIC";

export type TradeScope = {
  status: "open" | "burned";
  reason: string | null;
  findingId: string | null;
  burnedAt: string | null;
};

export type Authorization = {
  seq: number;
  clientOrderId: string;
  mandateHash: string;
  planId: string;
  planHash: string;
  approvalId: string;
  symbol: string;
  side: Side;
  type: OrderType;
  quantity: string;
  price: string | null;
  createdAt: string;
};

export type ObservedOrder = {
  orderId: string;
  clientOrderId: string | null;
  symbol: string;
  side: string;
  type: string;
  quantity: string;
  price: string | null;
  status?: string;
  raw?: unknown;
};

export type AuditEvent = {
  id: string;
  createdAt: string;
  outcome: StampOutcome;
  orderId: string | null;
  clientOrderId: string | null;
  symbol: string | null;
  seq: number | null;
  explanation: string;
  undetermined: string[];
  exchange: unknown;
};

export type BootGuard = {
  id: string;
  status: "PASS" | "WARN" | "FAIL";
  detail: string;
};
