import { randomUUID } from "node:crypto";
import { BossError } from "../lib/errors.ts";
import { sha256Json } from "../lib/hash.ts";
import { alignDown, alignUp, asFixed, D } from "../lib/money.ts";
import { evaluatePolicy } from "../policy/engine.ts";
import type { AccountSnapshot, Intent, Mandate, Observation, Plan, SignalBoard } from "../types.ts";

export function buildPlan(input: {
  intent: Intent;
  observation: Observation;
  signals: SignalBoard;
  account: AccountSnapshot | null;
  mandate: Mandate;
  dailyNotional: string;
}): Plan {
  if (input.intent.action !== "plan" || !input.intent.side) {
    throw new BossError("NOT_A_PLAN", "This command is observation-only. Add buy/sell and a size.");
  }

  const side = input.intent.side;
  const type = input.intent.orderType;
  const filters = input.observation.filters;
  const minNot = D(filters.minNotional);
  const limitPrice =
    type === "MARKET"
      ? null
      : alignPrice(
          input.intent.limitPrice ?? (side === "BUY" ? input.observation.bid : input.observation.ask),
          filters.tickSize,
          side,
        );

  const notionalPrice =
    type === "MARKET"
      ? D(side === "BUY" ? input.observation.ask : input.observation.bid)
      : D(limitPrice!);
  if (notionalPrice.lte(0)) throw new BossError("PRICE", "Reference price is not usable.");

  let quantity: ReturnType<typeof D>;
  if (input.intent.baseQty) {
    quantity = alignDown(input.intent.baseQty, filters.stepSize);
  } else if (input.intent.quoteQty) {
    quantity = alignDown(D(input.intent.quoteQty).div(notionalPrice), filters.stepSize);
  } else {
    throw new BossError(
      "SIZE",
      "A plan needs a size. Example: plan buy 50 usdt BTCUSDT  or  plan sell 0.01 BTCUSDT",
    );
  }

  if (quantity.lte(0)) {
    throw new BossError("SIZE", "Aligned quantity rounded to zero. Increase the size.");
  }

  quantity = ensureMinNotionalQuantity(quantity, notionalPrice, minNot, filters.stepSize);

  const notional = asFixed(quantity.times(notionalPrice).toDecimalPlaces(8));
  const order: Plan["order"] = {
    symbol: input.observation.symbol,
    side,
    type,
    timeInForce: type === "LIMIT" ? "GTC" : null,
    quantity: asFixed(quantity),
    price: limitPrice,
    quoteSpend: input.intent.quoteQty ?? notional,
    notional,
  };

  const policy = evaluatePolicy({
    mandate: input.mandate,
    observation: input.observation,
    order,
    account: input.account,
    dailyNotional: input.dailyNotional,
  });

  const createdAt = new Date().toISOString();
  const body = {
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    quantity: order.quantity,
    price: order.price,
    last: input.observation.last,
    bid: input.observation.bid,
    ask: input.observation.ask,
    bookId: input.observation.book.lastUpdateId,
  };
  const planHash = sha256Json(body);
  const notes = buildNotes(input);

  return {
    id: `plan_${randomUUID().slice(0, 12)}`,
    createdAt,
    intent: { ...input.intent, symbol: input.observation.symbol },
    observation: input.observation,
    signals: input.signals,
    account: input.account,
    order,
    planHash,
    policy,
    notes,
  };
}

function alignPrice(price: string, tick: string, side: "BUY" | "SELL"): string {
  return asFixed(side === "BUY" ? alignDown(price, tick) : alignUp(price, tick));
}

function ensureMinNotionalQuantity(
  quantity: ReturnType<typeof D>,
  price: ReturnType<typeof D>,
  minNotional: ReturnType<typeof D>,
  stepSize: string,
): ReturnType<typeof D> {
  let qty = quantity;
  let guard = 0;
  while (qty.times(price).lt(minNotional) && guard++ < 10_000) {
    qty = alignUp(minNotional.div(price), stepSize);
    if (qty.lte(quantity)) {
      qty = alignUp(quantity.plus(stepSize), stepSize);
    }
  }
  if (qty.times(price).lt(minNotional)) {
    throw new BossError("SIZE", `Cannot reach minNotional ${asFixed(minNotional)} at price ${asFixed(price)}.`);
  }
  return qty;
}

function buildNotes(input: {
  observation: Observation;
  signals: SignalBoard;
  intent: Intent;
}): string[] {
  const notes: string[] = [];
  const obs = input.observation;
  notes.push(
    `Live Spot ${obs.symbol}: last ${obs.last}, bid ${obs.bid}, ask ${obs.ask}, spread ${obs.spreadBps} bps.`,
  );
  notes.push(
    `24h change ${obs.change24hPct}% · range ${obs.low24h}–${obs.high24h} · quote volume ${obs.volumeQuote}.`,
  );
  if (obs.sma20_1h && obs.lastVsSma20Bps) {
    notes.push(`Last vs 20×1h SMA (${obs.sma20_1h}): ${obs.lastVsSma20Bps} bps.`);
  }
  notes.push(
    `Top-10 book imbalance ${obs.book.imbalance} (−1 offer-heavy, +1 bid-heavy).`,
  );
  if (input.signals.symbolHits.trending) {
    notes.push(
      `${obs.symbol} appears on the live BSC trending board (${input.signals.symbolHits.trending.extra}).`,
    );
  }
  if (input.signals.symbolHits.smartMoney) {
    notes.push(
      `${obs.symbol} appears on the live smart-money inflow board (${input.signals.symbolHits.smartMoney.extra}).`,
    );
  }
  if (!input.signals.symbolHits.trending && !input.signals.symbolHits.smartMoney) {
    notes.push("This Spot pair is not in the current BSC trending or smart-money top lists.");
  }
  notes.push("Numbers come from Binance. BOSS does not invent prices or fills.");
  return notes;
}
