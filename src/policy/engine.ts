import { loadScope } from "../audit/scope.ts";
import { asFixed, bpsDiff, D, isMultiple } from "../lib/money.ts";
import type {
  AccountSnapshot,
  Mandate,
  Observation,
  Plan,
  PolicyResult,
  RuleResult,
  Verdict,
} from "../types.ts";

export function evaluatePolicy(input: {
  mandate: Mandate;
  observation: Observation;
  order: Plan["order"];
  account: AccountSnapshot | null;
  dailyNotional: string;
  nowMs?: number;
}): PolicyResult {
  const now = input.nowMs ?? Date.now();
  const rules: RuleResult[] = [
    kill(input.mandate),
    tradeScope(),
    product(),
    trading(input.observation),
    allowlist(input.mandate, input.observation.symbol),
    side(input.mandate, input.order.side),
    orderType(input.mandate, input.order.type),
    quoteAsset(input.observation),
    lot(input.observation, input.order.quantity),
    notionalMin(input.observation, input.order.notional),
    notionalMax(input.mandate, input.order.notional),
    daily(input.mandate, input.order.notional, input.dailyNotional),
    tick(input.observation, input.order),
    deviation(input.mandate, input.observation, input.order),
    spread(input.mandate, input.observation),
    freshness(input.mandate, input.observation, now),
    coverage(input.mandate, input.observation, input.order),
    balance(input.observation, input.order, input.account),
    approval(input.mandate),
  ];

  const failCount = rules.filter((r) => r.status === "FAIL").length;
  const unknownCount = rules.filter((r) => r.status === "UNKNOWN").length;
  const passCount = rules.filter((r) => r.status === "PASS").length;
  const verdict: Verdict = failCount ? "BLOCK" : unknownCount ? "UNKNOWN" : "CLEAR";
  return { verdict, rules, failCount, unknownCount, passCount };
}

function kill(mandate: Mandate): RuleResult {
  return mandate.killSwitch
    ? fail("KILL_SWITCH", "Kill switch is on. No plan can clear.")
    : pass("KILL_SWITCH", "Kill switch is off.");
}

function tradeScope(): RuleResult {
  const scope = loadScope();
  return scope.status === "burned"
    ? fail(
        "TRADE_SCOPE",
        `Trade scope is burned (${scope.reason ?? "audit finding"}). Restore from the desk after you inspect the finding.`,
      )
    : pass("TRADE_SCOPE", "Trade scope is open.");
}

function product(): RuleResult {
  return pass("PRODUCT_SPOT", "BOSS only plans Binance Spot.");
}

function trading(obs: Observation): RuleResult {
  return obs.status === "TRADING"
    ? pass("SYMBOL_TRADING", `${obs.symbol} status is TRADING.`)
    : fail("SYMBOL_TRADING", `${obs.symbol} status is ${obs.status}.`);
}

function allowlist(mandate: Mandate, symbol: string): RuleResult {
  if (!mandate.symbolAllowlist.length) {
    return pass("SYMBOL_ALLOWLIST", "No allowlist — any TRADING Spot symbol is eligible.");
  }
  return mandate.symbolAllowlist.includes(symbol)
    ? pass("SYMBOL_ALLOWLIST", `${symbol} is on the mandate allowlist.`)
    : fail("SYMBOL_ALLOWLIST", `${symbol} is not on the mandate allowlist.`);
}

function side(mandate: Mandate, value: Plan["order"]["side"]): RuleResult {
  return mandate.allowedSides.includes(value)
    ? pass("SIDE_ALLOWED", `${value} is allowed.`)
    : fail("SIDE_ALLOWED", `${value} is not allowed by the mandate.`);
}

function orderType(mandate: Mandate, value: Plan["order"]["type"]): RuleResult {
  return mandate.allowedOrderTypes.includes(value)
    ? pass("ORDER_TYPE_ALLOWED", `${value} is allowed.`)
    : fail("ORDER_TYPE_ALLOWED", `${value} is not allowed by the mandate.`);
}

function quoteAsset(obs: Observation): RuleResult {
  return obs.filters.quoteAsset === "USDT" || obs.filters.quoteAsset === "USDC" || obs.filters.quoteAsset === "FDUSD"
    ? pass("QUOTE_ASSET", `Quote asset is ${obs.filters.quoteAsset}.`)
    : fail("QUOTE_ASSET", `BOSS sizes in stable quote assets. This pair quotes ${obs.filters.quoteAsset}.`);
}

function lot(obs: Observation, qty: string): RuleResult {
  const q = D(qty);
  if (q.lte(0)) return fail("LOT_SIZE", "Quantity must be greater than zero.");
  if (q.lt(obs.filters.minQty)) return fail("LOT_SIZE", `Quantity ${qty} < minQty ${obs.filters.minQty}.`);
  if (q.gt(obs.filters.maxQty)) return fail("LOT_SIZE", `Quantity ${qty} > maxQty ${obs.filters.maxQty}.`);
  if (!isMultiple(q, obs.filters.stepSize)) {
    return fail("LOT_SIZE", `Quantity ${qty} is not a multiple of stepSize ${obs.filters.stepSize}.`);
  }
  return pass("LOT_SIZE", `Quantity ${qty} matches LOT_SIZE.`);
}

function notionalMin(obs: Observation, notional: string): RuleResult {
  return D(notional).lt(obs.filters.minNotional)
    ? fail("MIN_NOTIONAL", `Notional ${notional} < minNotional ${obs.filters.minNotional}.`)
    : pass("MIN_NOTIONAL", `Notional ${notional} meets minNotional ${obs.filters.minNotional}.`);
}

function notionalMax(mandate: Mandate, notional: string): RuleResult {
  return D(notional).gt(mandate.maxNotionalUsdt)
    ? fail("MAX_NOTIONAL", `Notional ${notional} exceeds mandate cap ${mandate.maxNotionalUsdt}.`)
    : pass("MAX_NOTIONAL", `Notional ${notional} is within the ${mandate.maxNotionalUsdt} cap.`);
}

function daily(mandate: Mandate, notional: string, used: string): RuleResult {
  const next = D(used).plus(notional);
  return next.gt(mandate.maxDailyNotionalUsdt)
    ? fail(
        "DAILY_NOTIONAL",
        `Daily ${asFixed(next)} would exceed ${mandate.maxDailyNotionalUsdt} (already used ${used}).`,
      )
    : pass("DAILY_NOTIONAL", `Daily usage ${used} + ${notional} is within ${mandate.maxDailyNotionalUsdt}.`);
}

function tick(obs: Observation, order: Plan["order"]): RuleResult {
  if (order.type === "MARKET" || order.price === null) {
    return pass("PRICE_TICK", "Market order has no limit price to align.");
  }
  const p = D(order.price);
  if (p.lt(obs.filters.minPrice) || (D(obs.filters.maxPrice).gt(0) && p.gt(obs.filters.maxPrice))) {
    return fail("PRICE_TICK", `Price ${order.price} outside [${obs.filters.minPrice}, ${obs.filters.maxPrice}].`);
  }
  return isMultiple(p, obs.filters.tickSize)
    ? pass("PRICE_TICK", `Price ${order.price} matches tickSize ${obs.filters.tickSize}.`)
    : fail("PRICE_TICK", `Price ${order.price} is not a multiple of tickSize ${obs.filters.tickSize}.`);
}

function deviation(mandate: Mandate, obs: Observation, order: Plan["order"]): RuleResult {
  if (order.type === "MARKET" || order.price === null) {
    return pass("PRICE_DEVIATION", "Market order uses the book, not a limit offset.");
  }
  const diff = bpsDiff(order.price, obs.last);
  return diff.gt(mandate.maxPriceDeviationBps)
    ? fail("PRICE_DEVIATION", `Limit is ${asFixed(diff)} bps from last ${obs.last} (cap ${mandate.maxPriceDeviationBps}).`)
    : pass("PRICE_DEVIATION", `Limit is ${asFixed(diff)} bps from last ${obs.last}.`);
}

function spread(mandate: Mandate, obs: Observation): RuleResult {
  return D(obs.spreadBps).gt(mandate.maxSpreadBps)
    ? fail("SPREAD_SANE", `Spread ${obs.spreadBps} bps exceeds cap ${mandate.maxSpreadBps}.`)
    : pass("SPREAD_SANE", `Spread ${obs.spreadBps} bps is within ${mandate.maxSpreadBps}.`);
}

function freshness(mandate: Mandate, obs: Observation, now: number): RuleResult {
  const age = now - obs.fetchedAtMs;
  return age > mandate.maxEvidenceAgeMs
    ? fail("EVIDENCE_FRESH", `Observation is ${age} ms old (max ${mandate.maxEvidenceAgeMs}).`)
    : pass("EVIDENCE_FRESH", `Observation age ${age} ms.`);
}

function coverage(mandate: Mandate, obs: Observation, order: Plan["order"]): RuleResult {
  const top = order.side === "BUY" ? obs.book.askQtyTop : obs.book.bidQtyTop;
  if (D(top).eq(0)) return fail("BOOK_COVERAGE", "Top-of-book quantity is zero.");
  const ratio = D(order.quantity).div(top);
  return ratio.gt(mandate.minBookCoverage)
    ? fail(
        "BOOK_COVERAGE",
        `Order qty ${order.quantity} is ${asFixed(ratio)} of top-10 opposite size ${top} (cap ${mandate.minBookCoverage}).`,
      )
    : pass("BOOK_COVERAGE", `Order is ${asFixed(ratio)} of top-10 opposite size ${top}.`);
}

function balance(
  obs: Observation,
  order: Plan["order"],
  account: AccountSnapshot | null,
): RuleResult {
  if (!account || account.mode === "ABSENT") {
    return unknown(
      "BALANCE_SUFFICIENT",
      "No account snapshot. Attach Agent OS balances or connect an API key. Planning still works; sending does not.",
    );
  }
  const asset = order.side === "BUY" ? obs.filters.quoteAsset : obs.filters.baseAsset;
  const need = order.side === "BUY" ? D(order.notional).times("1.001") : D(order.quantity);
  const row = account.balances.find((b) => b.asset === asset);
  const free = D(row?.free ?? 0);
  return free.gte(need)
    ? pass(
        "BALANCE_SUFFICIENT",
        `${asset} free ${asFixed(free)} covers ${asFixed(need.toDecimalPlaces(8))} (${account.mode}).`,
      )
    : fail(
        "BALANCE_SUFFICIENT",
        `${asset} free ${asFixed(free)} < ${asFixed(need.toDecimalPlaces(8))} (${account.mode}).`,
      );
}

function approval(mandate: Mandate): RuleResult {
  return mandate.requireApproval
    ? pass("APPROVAL_REQUIRED", "A typed EXECUTE approval is required before any send.")
    : pass("APPROVAL_REQUIRED", "Mandate does not require extra approval beyond the gate.");
}

function pass(id: string, detail: string): RuleResult {
  return { id, status: "PASS", detail };
}
function fail(id: string, detail: string): RuleResult {
  return { id, status: "FAIL", detail };
}
function unknown(id: string, detail: string): RuleResult {
  return { id, status: "UNKNOWN", detail };
}
