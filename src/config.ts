import path from "node:path";
import { readFileSync, existsSync } from "node:fs";

function loadDotEnv() {
  const file = path.join(process.cwd(), ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

export const config = {
  port: Number(process.env.PORT ?? 8790),
  dataDir: path.resolve(process.cwd(), process.env.BOSS_DATA_DIR ?? "var"),
  binanceSpotBase: (process.env.BINANCE_SPOT_BASE ?? "https://api.binance.com").replace(
    /\/$/,
    "",
  ),
  apiKey: process.env.BINANCE_API_KEY?.trim() || "",
  apiSecret: process.env.BINANCE_SECRET_KEY?.trim() || "",
  apiEnv: (process.env.BINANCE_API_ENV ?? "mainnet").trim(),
  userAgent: "BOSS/1.0.0",
  hmacSecret: process.env.BOSS_HMAC_SECRET?.trim() || "",
  cryptoPanicToken: process.env.CRYPTOPANIC_TOKEN?.trim() || "",
  allowOffline: process.env.BOSS_ALLOW_OFFLINE === "1" || process.env.VITEST === "true",
  auditPollMs: Number(process.env.BOSS_AUDIT_POLL_MS ?? 15_000),
  watchSymbols: (process.env.BOSS_WATCH_SYMBOLS ?? "")
    .split(",")
    .map((row) => row.trim())
    .filter(Boolean),
};

export function hasDirectApiKeys(): boolean {
  return Boolean(config.apiKey && config.apiSecret);
}
