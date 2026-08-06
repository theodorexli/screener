import { findArbitrageOpportunities } from './arb';
import { fetchKalshiExchangeStatus, fetchKalshiSeedMarkets } from './kalshi';
import { fetchPolymarketCatalog } from './polymarket';
import {
  buildPaginatedSnapshot,
  getEdgeCachedScan,
  getStaleCachedScan,
  setCachedScan,
  setEdgeCachedScan,
} from './scanCache';

interface Env {
  ALLOWED_ORIGINS: string;
  KALSHI_API_BASE: string;
  POLYMARKET_API_BASE: string;
}

const DEFAULT_SCAN_COUNT = 500;
const DEFAULT_SCAN_LIMIT = 100;
const MAX_SCAN_LIMIT = 150;
const POLY_CATALOG_SIZE = 2500;

function corsHeaders(origin: string, allowedOrigins: string): Headers {
  const origins = (allowedOrigins || '').split(',').map((o) => o.trim()).filter(Boolean);
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  });

  const isLocalhost =
    origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');

  if (origins.includes('*') || origins.includes(origin) || isLocalhost) {
    headers.set('Access-Control-Allow-Origin', origin);
  }

  return headers;
}

function jsonResponse(
  origin: string,
  env: Env,
  body: unknown,
  status = 200
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(origin, env.ALLOWED_ORIGINS),
  });
}

async function buildScanSnapshot(
  env: Env,
  scanCount: number,
  minProfit: number,
  maxResults: number
) {
  const kalshiBase = env.KALSHI_API_BASE.replace(/\/$/, '');
  const polymarketBase = env.POLYMARKET_API_BASE.replace(/\/$/, '');

  const [kalshiStatus, kalshiFetch, polymarketCatalog] = await Promise.all([
    fetchKalshiExchangeStatus(kalshiBase),
    fetchKalshiSeedMarkets(kalshiBase, scanCount),
    fetchPolymarketCatalog(polymarketBase, POLY_CATALOG_SIZE),
  ]);

  const snapshot = findArbitrageOpportunities({
    kalshiMarkets: kalshiFetch.seeds,
    kalshiOpenMarketCount: kalshiFetch.openMarketCount,
    polymarketMarkets: polymarketCatalog,
    exchangeStatus: { kalshi: kalshiStatus },
    minProfit,
    maxResults,
  });

  return {
    snapshot,
    allScanResults: snapshot.scanResults,
  };
}

async function warmScanCache(env: Env, scanCount: number, minProfit: number): Promise<void> {
  const cacheKey = `${scanCount}:${minProfit}`;
  const existing = await getEdgeCachedScan(cacheKey);
  if (existing) {
    return;
  }

  const { snapshot, allScanResults } = await buildScanSnapshot(env, scanCount, minProfit, 25);
  await setEdgeCachedScan(cacheKey, snapshot, allScanResults);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const requestUrl = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin, env.ALLOWED_ORIGINS),
      });
    }

    try {
      if (requestUrl.pathname === '/api/predictions/markets' && request.method === 'GET') {
        const limitParam = requestUrl.searchParams.get('limit');
        const minProfitParam = requestUrl.searchParams.get('min_profit');
        const limit = limitParam ? Math.min(Math.max(Number.parseInt(limitParam, 10) || 25, 1), 50) : 25;
        const minProfit = minProfitParam
          ? Math.max(Number.parseFloat(minProfitParam) || 0.005, 0)
          : 0.005;

        const scanTargetParam = requestUrl.searchParams.get('scan_target');
        const scanCount = scanTargetParam
          ? Math.min(Math.max(Number.parseInt(scanTargetParam, 10) || DEFAULT_SCAN_COUNT, 100), 1000)
          : DEFAULT_SCAN_COUNT;

        const scanOffsetParam = requestUrl.searchParams.get('scan_offset');
        const scanLimitParam = requestUrl.searchParams.get('scan_limit');
        const scanOffset = scanOffsetParam
          ? Math.max(Number.parseInt(scanOffsetParam, 10) || 0, 0)
          : 0;
        const scanLimit = scanLimitParam
          ? Math.min(Math.max(Number.parseInt(scanLimitParam, 10) || DEFAULT_SCAN_LIMIT, 1), MAX_SCAN_LIMIT)
          : DEFAULT_SCAN_LIMIT;

        const cacheKey = `${scanCount}:${minProfit}`;
        let cached = await getEdgeCachedScan(cacheKey);

        if (!cached) {
          try {
            const { snapshot, allScanResults } = await buildScanSnapshot(
              env,
              scanCount,
              minProfit,
              limit
            );
            cached = setCachedScan(cacheKey, snapshot, allScanResults);
            ctx.waitUntil(setEdgeCachedScan(cacheKey, snapshot, allScanResults));
          } catch (scanError) {
            console.error('Predictions scan failed, trying stale cache:', scanError);
            cached = await getStaleCachedScan(cacheKey);
            if (!cached) {
              throw scanError;
            }
          }
        }

        return jsonResponse(origin, env, {
          success: true,
          data: buildPaginatedSnapshot(cached, scanOffset, scanLimit),
        });
      }

      return jsonResponse(origin, env, { error: 'Not found' }, 404);
    } catch (error) {
      console.error('Predictions worker error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      const isRateLimited =
        message.includes('429') || message.toLowerCase().includes('too many requests');
      return jsonResponse(
        origin,
        env,
        {
          success: false,
          error: isRateLimited ? 'Rate limit exceeded' : 'Predictions request failed',
          message: isRateLimited
            ? 'Kalshi rate limit hit — retry in a few seconds'
            : message,
        },
        isRateLimited ? 503 : 500
      );
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(warmScanCache(env, DEFAULT_SCAN_COUNT, 0.005));
  },
};
