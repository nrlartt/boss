import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { config } from "../config.ts";

const MIN_LEN = 32;
let cached: string | null = null;

export function hmacSecret(): string {
  if (cached) return cached;
  const fromEnv = config.hmacSecret;
  if (fromEnv) {
    if (fromEnv.length < MIN_LEN) {
      throw new Error("BOSS_HMAC_SECRET must be at least 32 characters.");
    }
    cached = fromEnv;
    return cached;
  }
  const file = secretFile();
  mkdirSync(path.dirname(file), { recursive: true });
  if (existsSync(file)) {
    const raw = readFileSync(file, "utf8").trim();
    if (raw.length < MIN_LEN) {
      throw new Error("Stored HMAC secret is too short. Set BOSS_HMAC_SECRET or replace var/hmac.secret.");
    }
    cached = raw;
    return cached;
  }
  const generated = randomBytes(32).toString("hex");
  writeFileSync(file, `${generated}\n`, { encoding: "utf8" });
  cached = generated;
  return cached;
}

export function hmacSecretSource(): "env" | "file" | "generated" {
  if (config.hmacSecret) return "env";
  return existsSync(secretFile()) ? "file" : "generated";
}

function secretFile(): string {
  return path.join(config.dataDir, "hmac.secret");
}
