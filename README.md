# TXL Screener

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Hand-curated equity watchlists, technicals, heatmap/table views, and AI chat — backed by Cloudflare Workers.

**Live:** https://screener.txl.app  
**Source:** [GitHub](https://github.com/theodorexli/screener) · [GitLab](https://gitlab.com/sixmo19/screener)

## Features

- **Hand-curated watchlists** — visualize in a table or heatmap
- **Technical indicators** — RSI, MACD, EMAs, VWAP, volume, market cap
- **AI chat** — ask about a watchlist with recent news context (Gemini)
- **Predictions** — Kalshi ↔ Polymarket cross-venue scan (`/predictions`)
- **Portfolio helper** — growth calculator using optional Notion allocation weights

## Important

**Data may be delayed**: Alpaca data can lag 15+ minutes. Always verify with official sources before trading.

**Not investment advice**: Nothing here is financial advice. Do your own diligence.

## Stack

- **Frontend**: React + TypeScript + Vite → GitLab Pages (or any static host)
- **API**: Cloudflare Worker (`worker/`) — Alpaca, Notion, Gemini, Logo.dev
- **Predictions**: Cloudflare Worker (`worker-predictions/`) — public Kalshi/Polymarket APIs

## Local development

1. Clone the repo and `npm install` at the root.
2. Start the main worker (separate terminal):
   ```bash
   cd worker
   npm install
   # Set secrets once via `npx wrangler secret put ...` or `worker/.dev.vars` (gitignored)
   npm run dev
   ```
   Worker: `http://localhost:8787`
3. Optional — predictions worker:
   ```bash
   npm run dev:predictions
   ```
   Worker: `http://localhost:8789`
4. Start the frontend:
   ```bash
   npm run dev
   ```
   App: `http://localhost:5173` (Vite proxies `/api` to the local workers)

To point the Vite proxy at deployed workers instead of localhost:

```bash
WORKER_PROXY_TARGET=https://your-api.workers.dev \
PREDICTIONS_PROXY_TARGET=https://your-predictions.workers.dev \
npm run dev
```

## Backend setup (your own deploy)

```bash
cd worker
npm install
npx wrangler login
```

Set secrets:

```bash
npx wrangler secret put ALPACA_API_KEY      # https://app.alpaca.markets/signup
npx wrangler secret put ALPACA_API_SECRET
npx wrangler secret put NOTION_API_KEY      # https://www.notion.so/my-integrations
npx wrangler secret put GEMINI_API_KEY      # https://aistudio.google.com/apikey
npx wrangler secret put LOGO_DEV_PUBLISHABLE_KEY  # https://www.logo.dev
```

Set `NOTION_DATABASE_ID` and `ALLOWED_ORIGINS` as **Worker secrets** (not in git):

```bash
npx wrangler secret put NOTION_DATABASE_ID
npx wrangler secret put ALLOWED_ORIGINS
# e.g. http://localhost:5173,https://your-frontend.example
```

Then:

```bash
npm run deploy
```

Deploy predictions:

```bash
cd worker-predictions
npm install
npx wrangler secret put ALLOWED_ORIGINS
npm run deploy
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for GitLab Pages + full troubleshooting.

## Environment variables (frontend)

See [env.example.txt](./env.example.txt).

| Variable | Purpose |
|----------|---------|
| `VITE_WORKER_URL` | Main API origin in production builds |
| `VITE_PREDICTIONS_WORKER_URL` | Predictions API origin in production |
| `VITE_PUBLIC_POSTHOG_KEY` | Optional analytics |

## Roadmap / ideas

- Richer chat (e.g. Parallel.ai-style real-time trackers)
- Bankroll-based allocation UX (aggressive / local weights)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [SECURITY.md](./SECURITY.md).

## License

MIT — see [LICENSE](./LICENSE). Copyright © 2025 TXL.
