---
name: boss
description: Permission-first Binance Spot copilot. Observe live markets through BOSS and Binance Agent OS, draft an exact order, run the fail-closed gate, and send only after the user types EXECUTE. Use when the user mentions BOSS, Binance Spot, Agent OS, preflight, approval, or wants to plan/send a trade.
metadata:
  version: "1.0.0"
  author: BOSS
license: MIT
---

# BOSS

BOSS is the operating layer between the user and Binance. Numbers come from live feeds. Do not invent prices, balances, fills, or order ids.

Run the desk (`npm start`) so the web UI and MCP share session state at `http://127.0.0.1:8790/mcp`.

## Hard rules

1. Never send an order unless the user just typed `EXECUTE`.
2. Never change quantity, price, side, symbol, or `newClientOrderId` from the BOSS packet.
3. Missing facts stay UNKNOWN. Do not guess.
4. Only `CLEAR` plans can be approved.
5. `boss_packet` does not consume the token. `boss_reconcile(approvalId)` or `boss_send_direct` does.
6. If `boss_audit` shows burned scope, stop. Do not send.

## Workflow

1. `boss_status`
2. `boss_plan` / `boss_observe`
3. Agent OS account → `boss_attach_account` → re-plan
4. Wait for `EXECUTE` → `boss_approve`
5. Send `packet.params` through Agent OS, including `newClientOrderId`
6. `boss_reconcile` with the real order id, stamp, and `approvalId`

Spot only.
