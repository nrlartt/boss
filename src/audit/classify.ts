import { D } from "../lib/money.ts";
import { hmacSecret } from "../stamp/secret.ts";
import { inspectClientOrderId, macMatches } from "../stamp/clientOrderId.ts";
import { mandateHash } from "../policy/mandate.ts";
import { getAuthorizationBySeq } from "./authorizations.ts";
import type { AuditEvent, ObservedOrder, StampOutcome } from "./types.ts";

export function classifyObservedOrder(order: ObservedOrder): Omit<AuditEvent, "id" | "createdAt"> {
  const tagged = inspectClientOrderId(order.clientOrderId);
  const secret = hmacSecret();
  const currentHash = mandateHash();

  if (tagged.kind === "absent" || tagged.kind === "foreign") {
    return finding("FOREIGN", order, null, "No BOSS stamp. The order did not go through the gate.", []);
  }
  if (tagged.kind === "malformed") {
    return finding("FORGED", order, null, "BOSS namespace without a valid stamp shape.", []);
  }

  const auth = getAuthorizationBySeq(tagged.seq);
  const hashForMac = auth?.mandateHash ?? currentHash;
  if (!macMatches(tagged.seq, hashForMac, tagged.mac, secret)) {
    return finding("FORGED", order, tagged.seq, "BOSS namespace with an invalid HMAC tag.", []);
  }
  if (!auth) {
    return finding(
      "UNKNOWN_AUTHENTIC",
      order,
      tagged.seq,
      "Stamp is authentic but BOSS has no matching authorization record.",
      ["authorization-record"],
    );
  }

  const mismatches = fieldMismatches(auth, order);
  if (mismatches.length) {
    return finding(
      "MISMATCHED",
      order,
      tagged.seq,
      `Stamp is authentic but the exchange order does not match what was authorised (${mismatches.join(", ")}).`,
      [],
    );
  }

  return finding("AUTHORISED", order, tagged.seq, "Executed as authorised.", []);
}

function fieldMismatches(auth: { symbol: string; side: string; type: string; quantity: string; price: string | null }, order: ObservedOrder): string[] {
  const mismatches: string[] = [];
  if (auth.symbol !== order.symbol) mismatches.push("symbol");
  if (auth.side !== order.side) mismatches.push("side");
  if (auth.type !== order.type) mismatches.push("type");
  if (!D(auth.quantity).eq(order.quantity)) mismatches.push("quantity");
  if (auth.price !== null && order.price !== null && !D(auth.price).eq(order.price || "0")) {
    mismatches.push("price");
  }
  return mismatches;
}

function finding(
  outcome: StampOutcome,
  order: ObservedOrder,
  seq: number | null,
  explanation: string,
  undetermined: string[],
): Omit<AuditEvent, "id" | "createdAt"> {
  return {
    outcome,
    orderId: order.orderId,
    clientOrderId: order.clientOrderId,
    symbol: order.symbol,
    seq,
    explanation,
    undetermined,
    exchange: order.raw ?? {
      orderId: order.orderId,
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      quantity: order.quantity,
      price: order.price,
      status: order.status ?? null,
    },
  };
}
