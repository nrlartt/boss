# Deploy BOSS on Railway

## One-click path (recommended)

1. Open [railway.app/new](https://railway.app/new)
2. **Deploy from GitHub repo** → select `nrlartt/boss`
3. Railway detects `railway.toml` and runs `npm start`
4. **Settings → Networking → Generate domain**
5. Copy the public URL (e.g. `https://boss-production-xxxx.up.railway.app`)
6. Edit `docs/live.json` in GitHub and set `"url"` to that domain, then push

No Binance API keys are required for the public demo. The hosted instance:

- reads live Binance public market data
- runs the full desk UI and BOSS MCP at `/mcp`
- shows a **LIVE · Binance Spot engine** status bar
- does not ship secrets from your local `.env`

## Optional environment variables

| Variable | Purpose |
|---|---|
| `BOSS_HOSTED=1` | Force hosted banner (auto-set on Railway) |
| `BINANCE_SPOT_BASE` | Defaults to `https://data-api.binance.vision` on Railway |
| `BOSS_PUBLIC_URL` | Override public base URL for MCP links |
| `BOSS_HMAC_SECRET` | Stable order stamps across redeploys (optional) |

Do **not** set `BINANCE_API_KEY` / `BINANCE_SECRET_KEY` on the public demo.

## CLI path

```bash
npx @railway/cli login
cd boss
npx @railway/cli init
npx @railway/cli up
npx @railway/cli domain
```

## Health check

`GET /api/health` must return `ok: true` and `binanceSpot.reachable: true` for the live engine bar to turn green.
