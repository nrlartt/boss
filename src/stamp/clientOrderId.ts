import { createHmac } from "node:crypto";

export const STAMP_PREFIX = "boss_";
const SEQ_WIDTH = 6;
const MAC_WIDTH = 16;
const STAMP_RE = /^boss_(\d{6})_([0-9a-f]{16})$/i;

export type StampInspect =
  | { kind: "absent" }
  | { kind: "foreign" }
  | { kind: "malformed" }
  | { kind: "tagged"; seq: number; mac: string };

export function mintClientOrderId(seq: number, mandateHash: string, secret: string): string {
  if (seq < 1 || seq > 999_999) {
    throw new Error("Stamp sequence out of range.");
  }
  const padded = String(seq).padStart(SEQ_WIDTH, "0");
  return `${STAMP_PREFIX}${padded}_${stampMac(seq, mandateHash, secret)}`;
}

export function inspectClientOrderId(clientOrderId: string | null | undefined): StampInspect {
  const id = String(clientOrderId ?? "").trim();
  if (!id) return { kind: "absent" };
  if (!id.toLowerCase().startsWith(STAMP_PREFIX)) return { kind: "foreign" };
  const match = STAMP_RE.exec(id);
  if (!match || !match[1] || !match[2]) return { kind: "malformed" };
  return { kind: "tagged", seq: Number(match[1]), mac: match[2].toLowerCase() };
}

export function stampMac(seq: number, mandateHash: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${seq}|${mandateHash}`)
    .digest("hex")
    .slice(0, MAC_WIDTH);
}

export function macMatches(seq: number, mandateHash: string, mac: string, secret: string): boolean {
  return mac.toLowerCase() === stampMac(seq, mandateHash, secret);
}
