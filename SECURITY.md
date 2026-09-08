# Security

## Secrets

- Never commit `.env`, `var/hmac.secret`, or API keys.
- `.gitignore` excludes `.env`, `var/`, and `var-test/`.
- Do **not** set `BINANCE_API_KEY` / `BINANCE_SECRET_KEY` on the public hosted demo.

## Hosted demo

The Railway deployment at [boss-desk-production.up.railway.app](https://boss-desk-production.up.railway.app/) runs without exchange credentials. It serves live **public** market data only. Sessions are shared on the hosted instance — use a local BOSS desk for private trading workflows.

## Order stamps

Approved orders include `newClientOrderId` values of the form `boss_<seq>_<hmac>`. The HMAC binds sequence and mandate hash. BOSS classifies ingested orders and burns trade scope on **FOREIGN**, **FORGED**, **MISMATCHED**, or **UNKNOWN_AUTHENTIC** outcomes.

Detection is not prevention: an unsigned bypass can fill before classification.

## Reporting

Open a [GitHub issue](https://github.com/nrlartt/boss/issues) for vulnerabilities. Do not post secrets or live API keys in issues.
