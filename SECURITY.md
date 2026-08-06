# Security Policy

## Supported versions

Security fixes are applied on the `main` branch of this repository.

## Reporting a vulnerability

Please report security issues privately (do not open a public issue) by contacting the maintainer via [txl.app](https://txl.app) or the repository host’s private vulnerability reporting if available.

Include:

- A description of the issue and its impact
- Steps to reproduce
- Whether you have a suggested fix

## Deployer responsibilities

This app proxies third-party APIs (Alpaca, Notion, Gemini, Logo.dev). When you deploy your own instance:

1. Store API credentials as Cloudflare Worker **secrets**, never in the frontend or git.
2. Set `ALLOWED_ORIGINS` to your frontend origins only.
3. Set `NOTION_DATABASE_ID` to **your** Notion database.
4. Expect public read endpoints (`/api/stocks`, `/api/watchlists`, etc.). Chat is rate-limited per IP but still costs money — consider Cloudflare Access, Turnstile, or stricter limits for high-traffic public deploys.
5. There is **no** open Notion write proxy. Do not reintroduce generic `/api/notion/*` forwarding without authentication.

## Known intentional tradeoffs

- Stock/news endpoints are unauthenticated so a public screener can load in the browser. Abuse resistance relies on caching, CORS, Cloudflare, and upstream provider limits.
- The PostHog project key (`VITE_PUBLIC_POSTHOG_KEY`) is a public client key by design.
