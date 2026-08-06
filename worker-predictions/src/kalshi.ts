import { isLiveSportsMicroProp, matchupClusterKey, parseKalshiEventDate, parseKalshiSportsTeamBlob, parseKalshiTeamSuffix, parseTitleEventDate, titleClusterKey } from './matching';
import type { ExchangeStatus, NormalizedMarket } from './types';

interface KalshiMarket {
  event_ticker: string;
  ticker: string;
  title: string;
  status: string;
  yes_ask_dollars?: string;
  no_ask_dollars?: string;
  yes_bid_dollars?: string;
  no_bid_dollars?: string;
  volume_fp?: string;
  market_type?: string;
}

interface KalshiExchangeStatus {
  exchange_active: boolean;
  trading_active: boolean;
  exchange_estimated_resume_time?: string | null;
}

const PAGE_SIZE = 1000;
const MAX_PAGES = 5;
/** Pages fetched with full normalization for seed diversification. */
const SEED_POOL_MAX_PAGES = 5;
/** Stop early once the seed pool is large enough to diversify. */
const SEED_POOL_MIN_MARKETS = 800;

function pickPrimaryEventMarket(markets: NormalizedMarket[]): NormalizedMarket {
  const byPreference = (predicate: (title: string) => boolean) =>
    markets.filter((market) => predicate(market.title));

  const gameWinner = byPreference((title) => /\bwinner\?\s*$/i.test(title.trim()));
  const pool = gameWinner.length
    ? gameWinner
    : byPreference((title) => /\bvs\.?\b|\bversus\b/i.test(title) && !/:/.test(title));

  const sorted = (pool.length ? pool : markets).sort((a, b) => b.volume - a.volume);
  const blob = parseKalshiSportsTeamBlob(sorted[0]?.eventId ?? '');
  if (blob && sorted.length > 1) {
    const aligned = sorted.find((market) => {
      const suffix = parseKalshiTeamSuffix(market.id);
      return suffix !== null && blob.startsWith(suffix.replace(/-/g, ''));
    });
    if (aligned) {
      return aligned;
    }
  }

  return sorted[0];
}

function diversifyKalshiSeeds(markets: NormalizedMarket[], targetCount: number): NormalizedMarket[] {
  const byEvent = new Map<string, NormalizedMarket[]>();

  for (const market of markets) {
    const group = byEvent.get(market.eventId);
    if (group) {
      group.push(market);
    } else {
      byEvent.set(market.eventId, [market]);
    }
  }

  const diversified = [...byEvent.values()].map((group) => pickPrimaryEventMarket(group));
  const byCluster = new Map<string, NormalizedMarket>();

  for (const market of diversified.sort((a, b) => b.volume - a.volume)) {
    const cluster = matchupClusterKey(market.title) ?? titleClusterKey(market.title);
    const existing = byCluster.get(cluster);
    if (!existing) {
      byCluster.set(cluster, market);
      continue;
    }

    const preferCurrent =
      /\bwinner\?\s*$/i.test(market.title.trim()) &&
      !/\bwinner\?\s*$/i.test(existing.title.trim());
    if (preferCurrent) {
      byCluster.set(cluster, market);
    }
  }

  return [...byCluster.values()].sort((a, b) => b.volume - a.volume).slice(0, targetCount);
}

function parsePrice(value?: string): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseVolume(value?: string): number {
  if (!value) {
    return 0;
  }
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function buildKalshiMarketUrl(eventTicker: string): string {
  const seriesTicker = eventTicker.split('-')[0];
  return `https://kalshi.com/markets/${seriesTicker.toLowerCase()}/${eventTicker.toLowerCase()}`;
}

function normalizeKalshiMarket(market: KalshiMarket): NormalizedMarket | null {
  if (market.market_type && market.market_type !== 'binary') {
    return null;
  }

  const yesAsk = parsePrice(market.yes_ask_dollars);
  const noAsk = parsePrice(market.no_ask_dollars);
  if (yesAsk === null || noAsk === null) {
    return null;
  }

  const title = market.title?.trim();
  if (!title) {
    return null;
  }

  return {
    platform: 'kalshi',
    id: market.ticker,
    eventId: market.event_ticker,
    eventDate: parseKalshiEventDate(market.event_ticker) ?? parseTitleEventDate(title),
    title,
    yesAsk,
    noAsk,
    volume: parseVolume(market.volume_fp),
    url: buildKalshiMarketUrl(market.event_ticker),
  };
}

const MAX_RETRIES = 2;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchKalshiJson<T>(baseUrl: string, path: string): Promise<T> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { Accept: 'application/json' },
    });

    if (response.ok) {
      return response.json() as Promise<T>;
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < MAX_RETRIES - 1) {
      const retryAfterHeader = response.headers.get('Retry-After');
      const retryAfterMs = retryAfterHeader
        ? Math.max(1000, (Number.parseInt(retryAfterHeader, 10) || 1) * 1000)
        : Math.min(1000 * 2 ** attempt, 8000);
      await sleep(retryAfterMs);
      continue;
    }

    throw new Error(`Kalshi API error: ${response.status} ${response.statusText}`);
  }

  throw new Error('Kalshi API error: max retries exceeded');
}

export async function fetchKalshiExchangeStatus(baseUrl: string): Promise<ExchangeStatus['kalshi']> {
  const data = await fetchKalshiJson<KalshiExchangeStatus>(baseUrl, '/exchange/status');
  return {
    exchangeActive: data.exchange_active,
    tradingActive: data.trading_active,
    estimatedResumeTime: data.exchange_estimated_resume_time ?? null,
  };
}

export async function fetchKalshiSeedMarkets(
  baseUrl: string,
  targetCount: number
): Promise<{ seeds: NormalizedMarket[]; openMarketCount: number }> {
  const seenTickers = new Set<string>();
  const seedPool: NormalizedMarket[] = [];
  let openMarketCount = 0;
  let cursor: string | undefined;

  for (let pages = 0; pages < MAX_PAGES; pages += 1) {
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const data = await fetchKalshiJson<{ markets: KalshiMarket[]; cursor?: string }>(
      baseUrl,
      `/markets?status=open&limit=${PAGE_SIZE}&mve_filter=exclude${cursorParam}`
    );

    openMarketCount += data.markets?.length ?? 0;

    if (pages < SEED_POOL_MAX_PAGES || seedPool.length < targetCount * 2) {
      for (const market of data.markets || []) {
        if (seenTickers.has(market.ticker)) {
          continue;
        }

        const normalized = normalizeKalshiMarket(market);
        if (!normalized || isLiveSportsMicroProp(normalized.title)) {
          continue;
        }

        seenTickers.add(market.ticker);
        seedPool.push(normalized);
      }
    }

    cursor = data.cursor || undefined;
    if (!cursor) {
      break;
    }

    if (
      pages + 1 >= SEED_POOL_MAX_PAGES &&
      seedPool.length >= Math.min(SEED_POOL_MIN_MARKETS, targetCount * 2)
    ) {
      break;
    }
  }

  return {
    seeds: diversifyKalshiSeeds(seedPool, targetCount),
    openMarketCount,
  };
}
