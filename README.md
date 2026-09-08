# BOSS

[![License: MIT](https://img.shields.io/github/license/nrlartt/boss)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](package.json)
[![CI](https://github.com/nrlartt/boss/actions/workflows/ci.yml/badge.svg)](https://github.com/nrlartt/boss/actions/workflows/ci.yml)

**Observe. Plan. Approve. Then act.**

Permission-first copilot for **Binance Spot**, built to run beside [Binance Agent OS](https://www.binance.com/en/agent-os).

BOSS reads live market data, sizes orders to exchange filters, runs a fail-closed policy gate, and only mints a send token after you type **EXECUTE**. It does not invent prices. If Binance is unreachable, BOSS stops.

| | |
|---|---|
| **Live demo** | [boss-desk-production.up.railway.app](https://boss-desk-production.up.railway.app/) |
| **Desk** | [/app/](https://boss-desk-production.up.railway.app/app/) |
| **Docs** | [/docs/](https://boss-desk-production.up.railway.app/docs/) |
| **License** | MIT |

---

## Why BOSS

Most guardrails verify **what** an agent is about to send. BOSS also controls **when** sending is allowed:

- **BLOCK** — a hard rule failed; no approval, no send
- **UNKNOWN** — required data is missing (usually balances); planning allowed, sending refused
- **CLEAR** — gate open; you still must type `EXECUTE`

Missing data is never treated as zero. Every approved order carries an HMAC `newClientOrderId` stamp. Post-trade ingestion classifies **AUTHORISED**, **FOREIGN**, **FORGED**, **MISMATCHED**, or **UNKNOWN_AUTHENTIC**.

Default mandate caps: **100 USDT per order**, **500 USDT per UTC day**, Spot only.

---

## Features

- Live Spot tape (20 symbols), order book, 1h/4h candles, WebSocket + REST fallback
- Analysis reports: technicals, Web3 pulse, public news RSS, Fear & Greed
- Exact lot / tick / min-notional sizing from `exchangeInfo`
- 19-rule policy matrix evaluated on every plan
- One-time `EXECUTE` approval tokens (60s TTL, single-use)
- Execution packet for Agent OS with unchanged fields + stamp
- Hash-chained local receipts and trade-scope burn on foreign orders
- **15 MCP tools** — same session as the web desk

---

## Architecture

```text
┌─────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│ MCP host    │────▶│ BOSS MCP / desk  │────▶│ Binance public REST │
│ Cursor etc. │     │ observe · plan   │     │ + Web3 signal boards│
└─────────────┘     │ policy · approve │     └─────────────────────┘
       │            └────────┬─────────┘
       │                     │ EXECUTE + packet
       ▼                     ▼
┌─────────────────────────────────────┐
│ Binance Agent OS MCP                │
│ agent.binance.com/mcp/agentic       │
│ account read · Spot order send      │
└─────────────────────────────────────┘
```

One Node process serves the landing page, desk UI, REST API, and Streamable HTTP MCP.

---

## Quick start (local)

**Requirements:** Node.js 22+

```bash
git clone https://github.com/nrlartt/boss.git
cd boss
npm install
npm test
npm start
```

| URL | Purpose |
|-----|---------|
| [http://127.0.0.1:8790/](http://127.0.0.1:8790/) | Landing page |
| [http://127.0.0.1:8790/app/](http://127.0.0.1:8790/app/) | Trading desk |
| [http://127.0.0.1:8790/mcp](http://127.0.0.1:8790/mcp) | BOSS MCP (Streamable HTTP) |
| [http://127.0.0.1:8790/docs/](http://127.0.0.1:8790/docs/) | Documentation |

Copy `.env.example` to `.env` only if you need custom settings or local API keys.

### Try these commands (desk command bar)

```text
analyze BTCUSDT
plan buy 50 usdt ETHUSDT
plan sell 0.01 BTCUSDT
```

Attach free balances (Operations tab or `boss_attach_account`) and re-run the plan so `BALANCE_SUFFICIENT` can pass. Only **CLEAR** plans accept `EXECUTE`.

---

## Agent OS workflow

1. **`boss_status`** — confirm Binance public feed is reachable
2. **`boss_plan`** — e.g. `plan buy 50 usdt BTCUSDT`
3. **`boss_attach_account`** — balances from Agent OS (if needed)
4. Re-run **`boss_plan`** until verdict is **CLEAR**
5. User types **`EXECUTE`** → **`boss_approve`**
6. Send **`boss_packet`** fields through Agent OS Spot order tool (unchanged)
7. **`boss_reconcile`** with exchange `orderId` + `approvalId`

### MCP configuration

```json
{
  "mcpServers": {
    "binance": {
      "url": "https://agent.binance.com/mcp/agentic",
      "auth": { "CLIENT_ID": "vscode" }
    },
    "boss": {
      "url": "http://127.0.0.1:8790/mcp"
    }
  }
}
```

Hosted: replace the BOSS URL with `https://<your-host>/mcp`.

Agent OS OAuth is supported on first-class clients (Claude, ChatGPT, Codex, VS Code, Grok). Error `3346001` means the host is not on Binance’s allowlist — use a listed client or optional local API keys after approval.

---

## MCP tools

| Tool | Phase | Description |
|------|-------|-------------|
| `boss_status` | read | Health, mandate, session, MCP URL |
| `boss_tape` | read | Live 24h tape for tracked symbols |
| `boss_observe` | read | Ticker, depth, filters, SMA, Web3 boards |
| `boss_analyze` | read | Full research report + scored summary |
| `boss_plan` | write | Parse command, size order, run policy gate |
| `boss_attach_account` | write | Attach host-observed balances |
| `boss_approve` | write | Mint token when phrase is exactly `EXECUTE` |
| `boss_packet` | read | Execution packet (does not consume token) |
| `boss_send_direct` | write | Send via local API keys (optional) |
| `boss_reconcile` | write | Record Agent OS order id, classify stamp |
| `boss_ingest_order` | write | Ingest exchange order for classification |
| `boss_audit` | read | Scope, stamp counters, audit events |
| `boss_receipt` | read | Receipt by id or recent list |
| `boss_mandate` | read/write | Caps, allowlist, kill switch |
| `boss_plan_get` | read | Fetch stored plan by id |

---

## Policy rules (19)

Evaluated on every plan, in order:

`KILL_SWITCH` · `TRADE_SCOPE` · `PRODUCT_SPOT` · `SYMBOL_TRADING` · `SYMBOL_ALLOWLIST` · `SIDE_ALLOWED` · `ORDER_TYPE_ALLOWED` · `QUOTE_ASSET` · `LOT_SIZE` · `MIN_NOTIONAL` · `MAX_NOTIONAL` · `DAILY_NOTIONAL` · `PRICE_TICK` · `PRICE_DEVIATION` · `SPREAD_SANE` · `EVIDENCE_FRESH` · `BOOK_COVERAGE` · `BALANCE_SUFFICIENT` · `APPROVAL_REQUIRED`

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8790` | HTTP port |
| `BOSS_DATA_DIR` | `./var` | Mandate, session, receipts |
| `BINANCE_SPOT_BASE` | `https://api.binance.com` | Public Spot REST base URL |
| `BOSS_HMAC_SECRET` | auto | 32+ char secret for order stamps |
| `BOSS_ALLOW_OFFLINE` | `0` | Skip public feed boot guard if `1` |
| `BOSS_HOSTED` | auto on Railway | Hosted mode flag |
| `BOSS_PUBLIC_URL` | auto | Public base URL for MCP links |
| `BOSS_WATCH_SYMBOLS` | — | Extra tape symbols (comma-separated) |
| `BINANCE_API_KEY` | — | Optional; local signed send only |
| `BINANCE_SECRET_KEY` | — | Optional; local signed send only |
| `BINANCE_API_ENV` | `mainnet` | Must be `mainnet` for signed orders |

Never commit `.env`. See [SECURITY.md](./SECURITY.md).

---

## Development

```bash
npm run dev        # watch mode
npm test           # vitest (20 tests)
npm run typecheck  # tsc --noEmit
```

Boot guards run at startup: HMAC, mandate, receipt chain, public feed, clock skew. Any **FAIL** refuses to listen (except feed when `BOSS_ALLOW_OFFLINE=1`).

---

## Deploy

Railway one-click deploy from this repo. See [DEPLOY.md](./DEPLOY.md).

Cloud hosts use `https://data-api.binance.vision` when `BINANCE_SPOT_BASE` is unset.

---

## Project layout

```text
public/           Landing page, desk UI, docs
src/
  analysis/       Research reports, RSS, technicals
  audit/          Scope burn, stamp classification, boot guards
  desk/           HTTP service, commands, alerts, session
  http/           Server + static routing
  market/         Binance REST/WS, signals, signed API
  mcp/            MCP tool definitions
  plan/           Order sizing planner
  policy/         Mandate + 19-rule engine
  receipts/       Hash-chained receipt store
  stamp/          HMAC clientOrderId
tests/            Vitest suite
skills/boss/      Agent skill for Cursor / Agent OS hosts
```

---

## Disclaimer

BOSS is software, not financial advice. Digital-asset markets are volatile. You are responsible for eligibility, local regulations, Agent OS permissions, and every order you approve. Revoke Agent OS access from your Binance account when needed.
