import { config } from "../config.ts";
import { BossError } from "./errors.ts";

const TIMEOUT_MS = 12_000;

export async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  return requestJson<T>(url, { method: "GET", headers });
}

export async function postJson<T>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  return requestJson<T>(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

export async function requestSignedJson<T>(
  url: string,
  method: "GET" | "POST",
  headers: Record<string, string> = {},
): Promise<T> {
  return requestJson<T>(url, { method, headers });
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        accept: "application/json",
        "user-agent": config.userAgent,
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } catch (error) {
    clearTimeout(timer);
    const message = error instanceof Error ? error.message : String(error);
    throw new BossError(
      "NETWORK",
      `Request failed: ${message}`,
      502,
      "Check connectivity to Binance. BOSS never substitutes a placeholder price.",
    );
  }
  clearTimeout(timer);

  const text = await res.text();
  if (isRestricted(res.status, text)) {
    throw new BossError(
      "REGION_RESTRICTED",
      "Binance refused this request from the current network location.",
      451,
      "Run BOSS from a network that Binance serves. Do not route through a US IP if the public API blocks it.",
    );
  }

  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new BossError(
        "UPSTREAM_INVALID",
        `Non-JSON response from ${url} (HTTP ${res.status}).`,
        502,
      );
    }
  }

  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "msg" in data
        ? String((data as { msg: unknown }).msg)
        : `HTTP ${res.status}`;
    throw new BossError("UPSTREAM", msg, res.status >= 500 ? 502 : 400);
  }

  return data as T;
}

function isRestricted(status: number, body: string): boolean {
  if (status === 451) return true;
  const lower = body.toLowerCase();
  return (
    lower.includes("restricted location") ||
    lower.includes("unavailable from a restricted") ||
    lower.includes("service unavailable from a restricted")
  );
}
