import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { config } from "../config.ts";
import { BossError } from "../lib/errors.ts";
import { sha256Json } from "../lib/hash.ts";
import type { Mandate } from "../types.ts";

export const DEFAULT_MANDATE: Mandate = {
  version: 1,
  product: "SPOT",
  killSwitch: false,
  allowedSides: ["BUY", "SELL"],
  allowedOrderTypes: ["LIMIT", "MARKET"],
  maxNotionalUsdt: "100",
  maxDailyNotionalUsdt: "500",
  maxPriceDeviationBps: "50",
  maxSpreadBps: "40",
  maxEvidenceAgeMs: 15_000,
  approvalTtlMs: 60_000,
  requireApproval: true,
  minBookCoverage: "0.25",
  symbolAllowlist: [],
};

function mandatePath(): string {
  return path.join(config.dataDir, "mandate.json");
}

export function loadMandate(): Mandate {
  mkdirSync(config.dataDir, { recursive: true });
  const file = mandatePath();
  if (!existsSync(file)) {
    writeFileSync(file, JSON.stringify(DEFAULT_MANDATE, null, 2));
    return { ...DEFAULT_MANDATE };
  }
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Mandate;
  return { ...DEFAULT_MANDATE, ...parsed, version: 1, product: "SPOT" };
}

export function saveMandate(next: Mandate): Mandate {
  if (next.product !== "SPOT") {
    throw new BossError("MANDATE", "BOSS only mandates Spot.");
  }
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(mandatePath(), JSON.stringify(next, null, 2));
  return next;
}

export function setKillSwitch(on: boolean): Mandate {
  const mandate = loadMandate();
  mandate.killSwitch = on;
  return saveMandate(mandate);
}

export function mandateHash(mandate: Mandate = loadMandate()): string {
  return sha256Json(mandate);
}
