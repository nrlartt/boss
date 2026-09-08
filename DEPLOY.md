# Deploy BOSS

## Railway (recommended)

1. [railway.app/new](https://railway.app/new) → **Deploy from GitHub repo** → `nrlartt/boss`
2. **Settings → Networking → Generate domain**
3. Set optional variables:

| Variable | Value |
|----------|--------|
| `BOSS_PUBLIC_URL` | `https://<your-domain>` |
| `BOSS_HOSTED` | `1` |
| `BINANCE_SPOT_BASE` | `https://data-api.binance.vision` (auto on hosted if unset) |

Do not set Binance API keys on the public demo.

4. Verify: `GET https://<your-domain>/api/health` → `"ok": true`, `"binanceSpot.reachable": true`

### Routes

| Path | Serves |
|------|--------|
| `/` | Landing page |
| `/app/` | Trading desk |
| `/docs/` | Documentation |
| `/mcp` | BOSS MCP (Streamable HTTP) |
| `/api/*` | REST API |

## CLI

```bash
npx @railway/cli login
npx @railway/cli link
npx @railway/cli up
npx @railway/cli domain
```

## GitHub Pages

The `docs/` folder redirects to the live Railway site. Enable Pages from the `docs/` directory on `main` if you want `https://nrlartt.github.io/boss/` as a secondary entry point.
