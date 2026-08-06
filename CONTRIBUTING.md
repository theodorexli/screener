# Contributing

Thanks for interest in TXL Screener. Small, focused PRs are easiest to review.

## Local development

1. Install Node.js 20+.
2. Copy `env.example.txt` guidance into a root `.env` if needed (usually not required for local proxy mode).
3. Start the main worker:
   ```bash
   cd worker && npm install && npm run dev
   ```
4. (Optional) Start the predictions worker:
   ```bash
   npm run dev:predictions
   ```
5. Start the frontend from the repo root:
   ```bash
   npm install && npm run dev
   ```

By default Vite proxies `/api` → `http://127.0.0.1:8787` and `/api/predictions` → `http://127.0.0.1:8789`. To hit a deployed worker instead:

```bash
WORKER_PROXY_TARGET=https://your-worker.workers.dev \
PREDICTIONS_PROXY_TARGET=https://your-predictions.workers.dev \
npm run dev
```

## Worker secrets

See `README.md` and `DEPLOYMENT.md`. Required for a full local/production stack:

- `ALPACA_API_KEY`, `ALPACA_API_SECRET`
- `NOTION_API_KEY`
- `NOTION_DATABASE_ID` (also settable in `worker/wrangler.toml` `[vars]`)
- `GEMINI_API_KEY`
- `LOGO_DEV_PUBLISHABLE_KEY`

## Notion database shape

Watchlists are built from a Notion database of ticker pages. Expected properties (names are matched case-insensitively / with common aliases in the worker):

| Property | Purpose |
|----------|---------|
| Symbol / Ticker | Equity ticker (required) |
| Watchlist | Multi-select or text tags that become watchlist IDs |
| Name / Long Name | Display name |
| Website | Used for logo lookup |
| Allocate Aggressive (or similar) | Optional portfolio weight % for the growth calculator |

Exact property parsing lives in `worker/src/index.ts` (`extractPropertyValue` / `fetchWatchlistsFromNotion`). Point `NOTION_DATABASE_ID` at your own DB and share the integration with it.

## Checks before opening a PR

```bash
npm run lint
npm run build
```

If you change the predictions matcher, also run:

```bash
cd worker-predictions && npx tsx scripts/test-match.mts
```

## Scope

- Do not reintroduce unauthenticated Notion API proxies.
- Do not commit `.env`, Wrangler `.dev.vars`, or real API secrets.
- Keep financial-disclaimer language intact.
