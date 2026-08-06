# Deployment Guide

Deploy the Cloudflare Workers (API) and the Vite frontend (static hosting). TXL uses GitLab Pages; any static host works if you set the same build env vars.

## Prerequisites

- Node.js 20+
- Cloudflare account with Workers enabled
- Alpaca, Notion, Gemini, and Logo.dev credentials (see README)
- Static host (GitLab Pages, Cloudflare Pages, etc.)

## Part 1: Cloudflare Workers

### Main API (`worker/`)

```bash
cd worker
npm install
npx wrangler login
```

1. Edit `wrangler.toml`:
   - `ALLOWED_ORIGINS` — your frontend origin(s)
   - `NOTION_DATABASE_ID` — your Notion database ID
2. Set secrets:

```bash
npx wrangler secret put ALPACA_API_KEY
npx wrangler secret put ALPACA_API_SECRET
npx wrangler secret put NOTION_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put LOGO_DEV_PUBLISHABLE_KEY
```

3. Deploy:

```bash
npm run deploy
```

Note the worker URL (e.g. `https://screener.YOUR_SUBDOMAIN.workers.dev`).

### Predictions (`worker-predictions/`)

```bash
cd worker-predictions
npm install
# Update ALLOWED_ORIGINS in wrangler.toml
npm run deploy
```

No API secrets required (public Kalshi / Polymarket data).

## Part 2: Frontend

### GitLab Pages (TXL / this repo)

Set CI/CD variables in GitLab (**Settings → CI/CD → Variables**) — do **not** commit them:

| Variable | Example |
|----------|---------|
| `VITE_WORKER_URL` | `https://your-api.workers.dev` |
| `VITE_PREDICTIONS_WORKER_URL` | `https://your-predictions.workers.dev` |
| `VITE_PUBLIC_POSTHOG_KEY` | optional PostHog project key |

`.gitlab-ci.yml` reads these at build time. Forks must set their own.

```bash
git push origin main
```

### Other hosts

```bash
VITE_WORKER_URL=https://your-api.workers.dev \
VITE_PREDICTIONS_WORKER_URL=https://your-predictions.workers.dev \
VITE_PUBLIC_POSTHOG_KEY=phc_optional \
npm ci && npm run build
```

Serve the `dist/` folder. SPA fallback: serve `index.html` for unknown paths (this repo copies `404.html` for GitLab Pages).

## Part 3: Verify

```bash
curl https://your-api.workers.dev/api/watchlists
curl "https://your-api.workers.dev/api/stocks?symbols=AAPL,MSFT"
curl "https://your-predictions.workers.dev/api/predictions/markets?limit=5"
```

Open the frontend, confirm Network calls hit your workers, and check there are no CORS errors.

## Local development

```bash
# Terminal 1
cd worker && npm run dev

# Terminal 2 (optional)
npm run dev:predictions

# Terminal 3
npm run dev
```

Or proxy the UI at deployed workers:

```bash
WORKER_PROXY_TARGET=https://your-api.workers.dev \
PREDICTIONS_PROXY_TARGET=https://your-predictions.workers.dev \
npm run dev
```

## Troubleshooting

### CORS errors

1. Add your frontend origin to `ALLOWED_ORIGINS` in both workers’ `wrangler.toml`
2. Redeploy workers
3. Hard-refresh the browser

### Failed to fetch

1. Confirm workers are deployed (`npx wrangler deployments list`)
2. Confirm `VITE_*_WORKER_URL` values used at **build** time
3. Curl the API directly

### Stock data empty

1. `npx wrangler secret list` in `worker/`
2. `npx wrangler tail` while reproducing

### Chat returns 429

Per-IP rate limit on `/api/chat` (~30 requests/minute). Wait and retry. For public forks under abuse, tighten limits in `worker/src/rateLimit.ts` or put the worker behind Cloudflare Access / Turnstile.

## Environment summary

### Frontend build

| Variable | Required | Notes |
|----------|----------|-------|
| `VITE_WORKER_URL` | Yes (prod) | Main API |
| `VITE_PREDICTIONS_WORKER_URL` | Yes (prod) | Predictions API |
| `VITE_PUBLIC_POSTHOG_KEY` | No | Public analytics key |

### Worker secrets / vars

| Name | Where |
|------|--------|
| `ALPACA_API_KEY` / `ALPACA_API_SECRET` | secret |
| `NOTION_API_KEY` | secret |
| `GEMINI_API_KEY` | secret |
| `LOGO_DEV_PUBLISHABLE_KEY` | secret |
| `NOTION_DATABASE_ID` | `wrangler.toml` `[vars]` |
| `ALLOWED_ORIGINS` | `wrangler.toml` `[vars]` |

## Cost notes

- Cloudflare Workers free tier: 100k requests/day
- Alpaca free tier: rate-limited market data
- Gemini / Logo.dev: usage-based — chat is the main variable cost
- GitLab Pages: free for public projects
