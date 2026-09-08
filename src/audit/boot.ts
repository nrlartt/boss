import { hmacSecret, hmacSecretSource } from "../stamp/secret.ts";
import { loadMandate, mandateHash } from "../policy/mandate.ts";
import { hasDirectApiKeys } from "../config.ts";
import { fetchTickers } from "../market/binance.ts";
import { getJson } from "../lib/http.ts";
import { config } from "../config.ts";
import { verifyReceiptChain } from "../receipts/store.ts";
import { loadScope } from "./scope.ts";
import { listAuthorizations } from "./authorizations.ts";
import { auditCounters, listAuditEvents } from "./events.ts";
import type { BootGuard } from "./types.ts";

let lastGuards: BootGuard[] = [];

export async function runBootGuards(): Promise<BootGuard[]> {
  const guards: BootGuard[] = [];
  guards.push(hmacGuard());
  guards.push(mandateGuard());
  guards.push(scopeGuard());
  guards.push(chainGuard());
  guards.push(authIndexGuard());
  guards.push(auditPathGuard());
  guards.push(await liveGuard());
  guards.push(await clockGuard());
  guards.push(withdrawalGuard());
  lastGuards = guards;
  return guards;
}

export function lastBootGuards(): BootGuard[] {
  return lastGuards;
}

export function printBootBanner(guards: BootGuard[]): void {
  console.log("BOSS boot guards");
  for (const guard of guards) {
    const mark = `[${guard.status}]`.padEnd(6);
    console.log(`  ${mark} ${guard.id.padEnd(22)} ${guard.detail}`);
  }
}

export function bootFailed(guards: BootGuard[]): boolean {
  return guards.some((guard) => guard.status === "FAIL");
}

function hmacGuard(): BootGuard {
  try {
    hmacSecret();
    const source = hmacSecretSource();
    return pass(
      "hmacSecret",
      source === "env"
        ? "BOSS_HMAC_SECRET loaded from environment."
        : "HMAC secret ready (local file).",
    );
  } catch (error) {
    return fail("hmacSecret", error instanceof Error ? error.message : String(error));
  }
}

function mandateGuard(): BootGuard {
  try {
    const mandate = loadMandate();
    return pass(
      "mandate",
      `Mandate ${mandateHash(mandate).slice(0, 8)} caps ${mandate.maxNotionalUsdt} USDT/order.`,
    );
  } catch (error) {
    return fail("mandate", error instanceof Error ? error.message : String(error));
  }
}

function scopeGuard(): BootGuard {
  try {
    const scope = loadScope();
    if (scope.status === "burned") {
      return warn("tradeScope", `Burned: ${scope.reason ?? "unspecified"}. Planning will BLOCK.`);
    }
    return pass("tradeScope", "Trade scope is open.");
  } catch (error) {
    return fail("tradeScope", error instanceof Error ? error.message : String(error));
  }
}

function chainGuard(): BootGuard {
  const result = verifyReceiptChain();
  if (!result.ok) return fail("receiptChain", result.error ?? "Receipt chain broken.");
  return pass(
    "receiptChain",
    result.count === 0
      ? "No receipts yet."
      : `Chain verified over ${result.count} receipts, head ${result.head?.slice(0, 8)}.`,
  );
}

function authIndexGuard(): BootGuard {
  const rows = listAuthorizations();
  return pass("authorisationIndex", `${rows.length} prior authorisations replayed.`);
}

function auditPathGuard(): BootGuard {
  const findings = listAuditEvents().filter((row) => row.outcome !== "AUTHORISED").length;
  if (hasDirectApiKeys()) {
    return pass(
      "auditPath",
      `Signed REST poller will watch mandate/tape symbols every ${config.auditPollMs} ms. Findings so far: ${findings}.`,
    );
  }
  return warn(
    "auditPath",
    "No API keys. FOREIGN/FORGED detection needs signed REST or boss_ingest_order from Agent OS.",
  );
}

async function liveGuard(): Promise<BootGuard> {
  if (config.allowOffline) {
    return warn("publicFeed", "BOSS_ALLOW_OFFLINE=1 — public feed not required at boot.");
  }
  try {
    const rows = await fetchTickers(["BTCUSDT"]);
    const last = rows[0]?.lastPrice ?? "?";
    return pass("publicFeed", `Binance public Spot reachable, BTCUSDT last ${last}.`);
  } catch (error) {
    return fail(
      "publicFeed",
      `Public market data unreachable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function clockGuard(): Promise<BootGuard> {
  try {
    const data = await getJson<{ serverTime: number }>(`${config.binanceSpotBase}/api/v3/time`);
    const skew = Math.abs(Date.now() - data.serverTime);
    if (skew > 5_000) {
      return fail("clockSkew", `Clock is ${skew} ms away from Binance (max 5000).`);
    }
    return pass("clockSkew", `Clock within ${skew} ms of exchange.`);
  } catch (error) {
    if (config.allowOffline) {
      return warn("clockSkew", "Skipped: offline boot.");
    }
    return warn("clockSkew", `Could not read /api/v3/time: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function withdrawalGuard(): BootGuard {
  if (!hasDirectApiKeys()) {
    return warn("withdrawalPermission", "Not verified: no signed API keys on this desk.");
  }
  return warn(
    "withdrawalPermission",
    "BOSS does not call apiRestrictions. Disable withdrawals on the key yourself.",
  );
}

function pass(id: string, detail: string): BootGuard {
  return { id, status: "PASS", detail };
}
function warn(id: string, detail: string): BootGuard {
  return { id, status: "WARN", detail };
}
function fail(id: string, detail: string): BootGuard {
  return { id, status: "FAIL", detail };
}
