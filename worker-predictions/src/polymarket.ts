import { normalizeTitle, parsePolymarketEventDate, parseTitleEventDate } from './matching';
import type { NormalizedMarket } from './types';

interface PolymarketEventRef {
  slug: string;
}

interface PolymarketMarket {
  id: string;
  question: string;
  slug: string;
  events?: PolymarketEventRef[];
  active: boolean;
  closed: boolean;
  bestBid?: number | string;
  bestAsk?: number | string;
  volume24hr?: number | string;
  volumeNum?: number | string;
  outcomes?: string;
  outcomePrices?: string;
  gameStartTime?: string | null;
}

interface PolymarketEvent {
  slug: string;
  title: string;
  active: boolean;
  closed: boolean;
  volume24hr?: number | string;
  markets?: PolymarketMarket[];
}

interface PolymarketSportMeta {
  sport: string;
  series: string;
}

const PAGE_SIZE = 100;
const VOLUME_CATALOG_PAGES = 4;
const VOLUME_EVENT_PAGES = 2;
const EVENTS_PAGE_LIMIT = 500;
/** Cap sports series fetches to stay under Workers subrequest limits. */
const MAX_SPORTS_SERIES_FETCHES = 10;

/** Sports with head-to-head game markets likely to overlap Kalshi. */
const SPORTS_SERIES_ALLOWLIST = new Set([
  'mlb',
  'nba',
  'wnba',
  'nhl',
  'nfl',
  'mls',
  'kbo',
  'cbb',
  'cfb',
  'ncaab',
  'epl',
  'ucl',
  'uel',
  'bkbbl',
  'cricipl',
  'cricpsl',
  'criccpl',
  'crict20blast',
  'cricbbl',
  'cricmlc',
  'cricsa20',
]);

function parsePrice(value?: number | string | null): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseVolume(market: PolymarketMarket): number {
  const value = market.volume24hr ?? market.volumeNum ?? 0;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getPolymarketPrices(market: PolymarketMarket): { yesAsk: number | null; noAsk: number | null } {
  const yesAsk = parsePrice(market.bestAsk);
  const yesBid = parsePrice(market.bestBid);

  if (yesAsk !== null && yesBid !== null) {
    return {
      yesAsk,
      noAsk: Math.max(0, Math.min(1, 1 - yesBid)),
    };
  }

  try {
    const prices = JSON.parse(market.outcomePrices || '[]') as string[];
    const yes = parsePrice(prices[0]);
    const no = parsePrice(prices[1]);
    if (yes !== null && no !== null) {
      return { yesAsk: yes, noAsk: no };
    }
  } catch {
    // Fall through
  }

  return { yesAsk: null, noAsk: null };
}

function buildPolymarketMarketUrl(eventSlug: string): string {
  return `https://polymarket.com/event/${eventSlug}`;
}

function isHeadToHeadMoneyline(question: string): boolean {
  return (
    /\bvs\.?\b/i.test(question) &&
    !/:\s|O\/U|Spread:|first inning|1st inning|2nd half|second half|overtime|run scored|total runs|total points|total goals|both teams to score|correct score|set \d/i.test(
      question
    )
  );
}

function normalizePolymarketMarket(
  market: PolymarketMarket,
  eventSlug: string
): NormalizedMarket | null {
  if (!market.active || market.closed || !market.question) {
    return null;
  }

  let outcomes: string[] = [];
  try {
    outcomes = JSON.parse(market.outcomes || '[]');
  } catch {
    outcomes = [];
  }

  if (outcomes.length !== 2) {
    return null;
  }

  const { yesAsk, noAsk } = getPolymarketPrices(market);
  if (yesAsk === null || noAsk === null) {
    return null;
  }

  return {
    platform: 'polymarket',
    id: market.id,
    eventId: eventSlug,
    eventDate: parsePolymarketEventDate(eventSlug, market.gameStartTime) ?? parseTitleEventDate(market.question),
    title: market.question,
    yesAsk,
    noAsk,
    volume: parseVolume(market),
    url: buildPolymarketMarketUrl(eventSlug),
  };
}

function pickEventMoneyline(event: PolymarketEvent): PolymarketMarket | null {
  const candidates = (event.markets ?? []).filter(
    (market) => market.active && !market.closed && isHeadToHeadMoneyline(market.question)
  );

  if (!candidates.length) {
    return null;
  }

  return candidates.sort((a, b) => a.question.length - b.question.length)[0];
}

const MAX_RETRIES = 2;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPolymarketJson<T>(baseUrl: string, path: string): Promise<T> {
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

    throw new Error(`Polymarket API error: ${response.status} ${response.statusText}`);
  }

  throw new Error('Polymarket API error: max retries exceeded');
}

function mergeMarkets(into: NormalizedMarket[], seenIds: Set<string>, batch: NormalizedMarket[]): void {
  for (const market of batch) {
    if (seenIds.has(market.id)) {
      continue;
    }
    seenIds.add(market.id);
    into.push(market);
  }
}

async function fetchVolumeMarkets(baseUrl: string): Promise<NormalizedMarket[]> {
  const markets: NormalizedMarket[] = [];
  const seenIds = new Set<string>();

  for (let page = 0; page < VOLUME_CATALOG_PAGES; page += 1) {
    const offset = page * PAGE_SIZE;
    const batch = await fetchPolymarketJson<PolymarketMarket[]>(
      baseUrl,
      `/markets?active=true&closed=false&limit=${PAGE_SIZE}&offset=${offset}&order=volume24hr&ascending=false`
    );

    if (!batch.length) {
      break;
    }

    const normalizedBatch: NormalizedMarket[] = [];
    for (const market of batch) {
      const eventSlug = market.events?.[0]?.slug ?? market.slug;
      const normalized = normalizePolymarketMarket(market, eventSlug);
      if (normalized) {
        normalizedBatch.push(normalized);
      }
    }

    mergeMarkets(markets, seenIds, normalizedBatch);
  }

  return markets;
}

async function fetchVolumeEventsMarkets(baseUrl: string): Promise<NormalizedMarket[]> {
  const markets: NormalizedMarket[] = [];
  const seenIds = new Set<string>();

  for (let page = 0; page < VOLUME_EVENT_PAGES; page += 1) {
    const offset = page * PAGE_SIZE;
    const events = await fetchPolymarketJson<PolymarketEvent[]>(
      baseUrl,
      `/events?active=true&closed=false&limit=${PAGE_SIZE}&offset=${offset}&order=volume24hr&ascending=false`
    );

    if (!events.length) {
      break;
    }

    for (const event of events) {
      if (!event.active || event.closed || !event.slug) {
        continue;
      }

      for (const market of event.markets ?? []) {
        const normalized = normalizePolymarketMarket(market, event.slug);
        if (normalized) {
          mergeMarkets(markets, seenIds, [normalized]);
        }
      }
    }
  }

  return markets;
}

async function fetchSportsSeriesMarkets(baseUrl: string): Promise<NormalizedMarket[]> {
  const sportsMeta = await fetchPolymarketJson<PolymarketSportMeta[]>(baseUrl, '/sports');
  const seriesToFetch = sportsMeta
    .filter((sport) => SPORTS_SERIES_ALLOWLIST.has(sport.sport))
    .slice(0, MAX_SPORTS_SERIES_FETCHES);

  const markets: NormalizedMarket[] = [];
  const seenIds = new Set<string>();

  for (const sport of seriesToFetch) {
    const events = await fetchPolymarketJson<PolymarketEvent[]>(
      baseUrl,
      `/events?series_id=${sport.series}&active=true&closed=false&limit=${EVENTS_PAGE_LIMIT}`
    );

    for (const event of events) {
      if (!event.active || event.closed || !event.slug) {
        continue;
      }

      const moneyline = pickEventMoneyline(event);
      if (!moneyline) {
        continue;
      }

      const normalized = normalizePolymarketMarket(moneyline, event.slug);
      if (normalized) {
        mergeMarkets(markets, seenIds, [normalized]);
      }
    }
  }

  return markets;
}

export async function fetchPolymarketCatalog(
  baseUrl: string,
  targetCount: number
): Promise<NormalizedMarket[]> {
  const [volumeMarkets, eventMarkets, sportsMarkets] = await Promise.all([
    fetchVolumeMarkets(baseUrl),
    fetchVolumeEventsMarkets(baseUrl),
    fetchSportsSeriesMarkets(baseUrl),
  ]);

  const seenIds = new Set<string>();
  const merged: NormalizedMarket[] = [];
  const cap = Math.max(targetCount, 2500);

  mergeMarkets(merged, seenIds, sportsMarkets);
  mergeMarkets(merged, seenIds, eventMarkets);
  mergeMarkets(merged, seenIds, volumeMarkets);

  if (merged.length > cap) {
    merged.sort((a, b) => b.volume - a.volume);
    return merged.slice(0, cap);
  }

  return merged;
}
