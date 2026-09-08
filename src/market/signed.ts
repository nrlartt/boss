import { createHmac } from "node:crypto";
import { config, hasDirectApiKeys } from "../config.ts";
import { BossError } from "../lib/errors.ts";
import { requestSignedJson } from "../lib/http.ts";
import type { AccountSnapshot, Plan } from "../types.ts";

type OrderAck = {
  orderId: number;
  clientOrderId: string;
  status: string;
  executedQty?: string;
  origQty?: string;
  price?: string;
};

export async function fetchApiAccount(): Promise<AccountSnapshot> {
  if (!hasDirectApiKeys()) {
    throw new BossError("NO_KEYS", "No BINANCE_API_KEY / BINANCE_SECRET_KEY configured.");
  }
  const data = await signedSpot<{ balances: { asset: string; free: string; locked: string }[] }>(
    "GET",
    "/api/v3/account",
    {},
  );
  return {
    mode: "LIVE",
    capturedAt: new Date().toISOString(),
    source: "binance-spot-signed /api/v3/account",
    balances: data.balances
      .filter((row) => Number(row.free) > 0 || Number(row.locked) > 0)
      .map((row) => ({ asset: row.asset, free: row.free })),
  };
}

export async function placeSpotOrder(plan: Plan, clientOrderId: string): Promise<OrderAck> {
  if (!hasDirectApiKeys()) {
    throw new BossError("NO_KEYS", "Direct API keys are not configured.");
  }
  if (config.apiEnv !== "mainnet") {
    throw new BossError(
      "API_ENV",
      `Refusing signed orders unless BINANCE_API_ENV=mainnet (got ${config.apiEnv}).`,
    );
  }
  const params: Record<string, string> = {
    symbol: plan.order.symbol,
    side: plan.order.side,
    type: plan.order.type,
    quantity: plan.order.quantity,
    newClientOrderId: clientOrderId,
  };
  if (plan.order.type === "LIMIT") {
    if (!plan.order.price) throw new BossError("PRICE", "Limit order missing price.");
    params.timeInForce = "GTC";
    params.price = plan.order.price;
  }
  return signedSpot<OrderAck>("POST", "/api/v3/order", params);
}

export type ExchangeOrder = {
  symbol: string;
  orderId: number;
  clientOrderId: string;
  price: string;
  origQty: string;
  status: string;
  side: string;
  type: string;
  time: number;
};

export async function fetchAllOrders(symbol: string, limit = 50): Promise<ExchangeOrder[]> {
  if (!hasDirectApiKeys()) {
    throw new BossError("NO_KEYS", "No BINANCE_API_KEY / BINANCE_SECRET_KEY configured.");
  }
  return signedSpot<ExchangeOrder[]>("GET", "/api/v3/allOrders", {
    symbol,
    limit: String(limit),
  });
}

async function signedSpot<T>(
  method: "GET" | "POST",
  path: string,
  extra: Record<string, string>,
): Promise<T> {
  const params = new URLSearchParams({
    ...extra,
    timestamp: String(Date.now()),
    recvWindow: "5000",
  });
  const signature = createHmac("sha256", config.apiSecret).update(params.toString()).digest("hex");
  params.set("signature", signature);
  const url = `${config.binanceSpotBase}${path}?${params.toString()}`;
  return requestSignedJson<T>(url, method, {
    "X-MBX-APIKEY": config.apiKey,
  });
}
