import { hasDirectApiKeys, config } from "../config.ts";
import { loadMandate } from "../policy/mandate.ts";
import { TAPE_SYMBOLS } from "../market/symbols.ts";
import { fetchAllOrders } from "../market/signed.ts";
import { listAuthorizations } from "./authorizations.ts";
import { ingestObservedOrder } from "./events.ts";

let timer: ReturnType<typeof setInterval> | null = null;

export function startAuditWatch(): void {
  if (!hasDirectApiKeys()) return;
  void pollOnce();
  timer = setInterval(() => {
    void pollOnce();
  }, config.auditPollMs);
  timer.unref?.();
}

export function stopAuditWatch(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

async function pollOnce(): Promise<void> {
  const symbols = watchSymbols();
  for (const symbol of symbols) {
    try {
      const rows = await fetchAllOrders(symbol, 50);
      for (const row of rows) {
        ingestObservedOrder({
          orderId: String(row.orderId),
          clientOrderId: row.clientOrderId ?? null,
          symbol: row.symbol,
          side: row.side,
          type: row.type,
          quantity: row.origQty,
          price: row.price && Number(row.price) > 0 ? row.price : null,
          status: row.status,
          raw: row,
        });
      }
    } catch (error) {
      console.error(`BOSS audit poll ${symbol}:`, error instanceof Error ? error.message : error);
    }
  }
}

function watchSymbols(): string[] {
  const mandate = loadMandate();
  const extra = config.watchSymbols;
  return [...new Set([...mandate.symbolAllowlist, ...TAPE_SYMBOLS, ...listAuthorizations().map((row) => row.symbol), ...extra])];
}
