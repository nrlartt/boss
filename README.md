# BOSS

**Observe. Plan. Approve. Then act.**

BOSS is a permission-first copilot for Binance Spot. It reads live market data, sizes an order to the exchange’s own filters, runs a fail-closed policy gate, and only then allows a send — through [Binance Agent OS](https://www.binance.com/en/agent-os) or optional signed API keys on your machine.

It does not invent prices. If Binance is unreachable, BOSS stops.

## What you get

- Live Spot tape, order book, and 24h stats from Binance public REST
- Trending and smart-money context from Binance Web3 public boards
- Exact lot-size / tick-size / min-notional sizing
- A rule matrix that can **BLOCK**, stay **UNKNOWN**, or go **CLEAR**
- One-time `EXECUTE` approval tokens
- An execution packet your Agent OS host can send without changing a field
- Local hash-chained receipts

Default caps: **100 USDT per order**, **500 USDT per UTC day**, Spot only, withdrawals never.

## Quick start

```bash
npm install
npm test
npm start
```

Open [http://127.0.0.1:8790](http://127.0.0.1:8790). MCP for Cursor is served from the same process at [http://127.0.0.1:8790/mcp](http://127.0.0.1:8790/mcp). The desk uses 8790 so Cursor can keep `localhost:8787` for Binance Agent OS login.

The desk and the agent share one session: plans, attached balances, and approvals persist in `var/`.

Try:

```
analyze BTCUSDT
plan buy 50 usdt ETHUSDT
plan sell 0.01 BTCUSDT
```

A plan without an attached account stays `UNKNOWN` on `BALANCE_SUFFICIENT`. Attach free balances in the desk (or via Agent OS → `boss_attach_account`) and run the same plan again. Only **CLEAR** plans can be approved.

## Agent OS

BOSS is meant to sit next to the official Binance MCP:

`https://agent.binance.com/mcp/agentic`

This repo already ships `.cursor/mcp.json` with both servers:

1. `binance` — official Agent OS (account + send)
2. `boss` — `http://127.0.0.1:8790/mcp` (same process as the desk)

Binance Agent OS does not support Dynamic Client Registration. The config uses a static OAuth `CLIENT_ID`. Binance’s first-class clients are Claude, ChatGPT, Codex, VS Code, and Grok. If login returns error `3346001` (agent not supported), connect Agent OS from a listed client, or send an already-approved order from the desk with optional local API keys.

Start the desk first, then enable the MCP servers. After you type `EXECUTE`, the agent sends the packet fields exactly and writes the real order id back with `boss_reconcile` (include `approvalId` so the token is consumed). `boss_packet` never places an order and never burns the token.

## Optional direct API

If you set `BINANCE_API_KEY` and `BINANCE_SECRET_KEY` in `.env`, the desk can send the **already approved** Spot order itself. Leave them unset to keep sending exclusive to Agent OS.

Never put keys in git. `.env` is ignored.

## Mandate

First run writes `var/mandate.json`. Caps, allowlist, spread limit, and the kill switch live there. The header button flips the kill switch immediately.

## Safety model

| Verdict | Meaning |
|---|---|
| `BLOCK` | A hard rule failed. No approval, no send. |
| `UNKNOWN` | A required fact is missing (usually balances). Planning is allowed. Sending is not. |
| `CLEAR` | The gate is open. You still have to type `EXECUTE`. |

Missing data is never treated as zero. Approval tokens expire (60s) and are single-use. If last price drifts beyond the mandate, send is refused and you re-plan.

## Order stamps

Every approved packet carries a `newClientOrderId` of the form `boss_<seq>_<hmac>`. The HMAC covers the sequence and the mandate hash, so copying the prefix is not enough to mint a valid tag.

When an exchange order is ingested (signed REST poller, `boss_ingest_order`, or `boss_reconcile`), BOSS classifies it:

| Outcome | Meaning |
|---|---|
| `AUTHORISED` | Stamp matches what BOSS authorised. |
| `MISMATCHED` | Stamp is real, fields are not. Burns trade scope. |
| `FOREIGN` | No BOSS stamp. Burns trade scope. |
| `FORGED` | `boss_` prefix, invalid tag. Burns trade scope. |
| `UNKNOWN_AUTHENTIC` | Valid tag, no local record. Burns trade scope. |

Burned scope makes the gate `BLOCK` until you `POST /api/scope/restore` from the desk. Detection is not prevention: a bypass can fill first.

Boot prints a guard banner. A `FAIL` (broken receipt chain, missing HMAC, public feed down) refuses to listen. `BOSS_ALLOW_OFFLINE=1` relaxes the feed check. `/api/audit` exposes counters and a `series` array for a later chart pass.

## Disclaimer

BOSS is software, not financial advice, and not an offer or solicitation to trade. Digital-asset markets can move against you. You are responsible for eligibility, local rules, permissions you grant to agents, and every order you approve.

Binance Agent OS permissions are configured in your Binance account. Disconnect or use Emergency Stop from the Agent OS dashboard if you need to revoke access.
