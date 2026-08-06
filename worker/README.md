

# Screener API - Cloudflare Worker

This Cloudflare Worker serves as a secure backend proxy for the stock screener application, handling API requests to **Alpaca Markets** while keeping API keys secure.

## Setup

### 1. Install Dependencies

```bash
cd worker
npm install
```

### 2. Configure Wrangler

Make sure you're logged in to Cloudflare:

```bash
npx wrangler login
```

### 3. Set secrets

```bash
npx wrangler secret put ALLOWED_ORIGINS
# Example: http://localhost:5173,https://your-frontend.example
npx wrangler secret put NOTION_DATABASE_ID
npx wrangler secret put ALPACA_API_KEY
npx wrangler secret put ALPACA_API_SECRET
npx wrangler secret put NOTION_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put LOGO_DEV_PUBLISHABLE_KEY
```

Alpaca keys: https://app.alpaca.markets/signup

## Development

To run the worker locally:

```bash
npm run dev
```

This will start a local server at `http://localhost:8787`.

### Testing Locally

You can test the API endpoints locally:

```bash
# Test watchlists endpoint
curl http://localhost:8787/api/watchlists

# Test stock data endpoint
curl "http://localhost:8787/api/stocks?symbols=AAPL,MSFT,GOOGL"

# Test config endpoint
curl http://localhost:8787/api/config
```

## Deployment

Deploy the worker to Cloudflare:

```bash
npm run deploy
```

After deployment, Cloudflare will provide you with a URL like:
```
https://screener-api.YOUR_SUBDOMAIN.workers.dev
```

## Update Frontend

After deploying the worker, update the frontend to use your worker URL:

1. Create a `.env` file in the root of your project (not in the worker directory):

```bash
VITE_WORKER_URL=https://screener-api.YOUR_SUBDOMAIN.workers.dev
```

2. For production deployment, you'll need to set this as an environment variable in your CI/CD pipeline.

## API Endpoints

### GET /api/stocks

Fetch stock data for given symbols.

**Query Parameters:**
- `symbols` (required): Comma-separated list of stock symbols

**Example:**
```
GET /api/stocks?symbols=AAPL,MSFT,GOOGL
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "symbol": "AAPL",
      "name": "Apple Inc.",
      "price": 175.43,
      "change": 2.15,
      "changePercent": 1.24,
      "volume": 52345678,
      "marketCap": 2800000000000,
      "rsi": 58.2,
      "pe": 28.5,
      "eps": 6.15,
      "macd": 1.25
    }
  ]
}
```

### GET /api/watchlists

Fetch watchlists configuration.

**Response:**
```json
{
  "defaultFavorites": ["recents", "ai-supercycle"],
  "defaultSort": {
    "column": "changePercent",
    "direction": "asc"
  },
  "watchlists": [
    {
      "id": "ai-supercycle",
      "name": "AI Supercycle",
      "symbols": ["ETN", "ASML", "BE", "NVDA", ...]
    }
  ]
}
```

### GET /api/config

Fetch table configuration including default color rules.

**Response:**
```json
{
  "defaultSort": {
    "column": "rsi",
    "direction": "asc"
  },
  "defaultColorRules": {
    "rsi": [
      { "operator": "<", "value": 25, "color": "#ef4444" }
    ]
  }
}
```

## Troubleshooting

### CORS Issues

If you're getting CORS errors, make sure:
1. `ALLOWED_ORIGINS` secret includes your frontend domain
2. You've redeployed the worker after updating the secret

### API Key Issues

If you're getting authentication errors:
1. Verify your API credentials are set correctly: `npx wrangler secret list`
2. Re-set the credentials:
   - `npx wrangler secret put ALPACA_API_KEY`
   - `npx wrangler secret put ALPACA_API_SECRET`

### Local Development

For local development, you can create a `.dev.vars` file (this is gitignored):

```
ALPACA_API_KEY=your_api_key_here
ALPACA_API_SECRET=your_api_secret_here
```

This file is used by `wrangler dev` for local testing.

## Security

- API credentials are stored as Cloudflare secrets and never exposed to the frontend
- CORS is configured to only allow requests from your specified domains
- `/api/chat` is rate-limited per client IP
- There is **no** open Notion API proxy — watchlists are fetched server-side only
- See root `SECURITY.md` for reporting and deployer guidance

