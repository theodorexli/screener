import {
  alignKalshiMarketToPolyYes,
  areEventDatesCompatible,
  areMetaCompatible,
  areSportsSlugTeamsCompatible,
  buildMarketMeta,
  countSharedTokens,
  effectiveEventDate,
  isStrongTitleMatch,
  jaccardFromTokenSets,
  parseKalshiSportsTeamBlob,
  parsePolymarketSportsTeams,
  type MarketMeta,
} from './matching';
import type {
  ArbitrageOpportunity,
  ArbitrageSnapshot,
  ArbitrageStrategy,
  ExchangeStatus,
  MarketQuote,
  NormalizedMarket,
  ScanResult,
} from './types';

const DEFAULT_MIN_MATCH_SCORE = 0.55;
const DEFAULT_MIN_PROFIT = 0.005;

interface IndexedPolymarket {
  market: NormalizedMarket;
  meta: MarketMeta;
}

interface PolymarketIndex {
  entries: IndexedPolymarket[];
  byToken: Map<string, number[]>;
  sportsH2HByDate: Map<string, number[]>;
}

interface SeedEntry {
  market: NormalizedMarket;
  meta: MarketMeta;
}

function toQuote(market: NormalizedMarket): MarketQuote {
  return {
    id: market.id,
    title: market.title,
    yesAsk: market.yesAsk ?? 0,
    noAsk: market.noAsk ?? 0,
    url: market.url,
    eventDate: effectiveEventDate(market),
  };
}

function isBetterCandidate(
  seedDate: string | null,
  next: { market: NormalizedMarket; score: number },
  current: { market: NormalizedMarket; score: number } | null
): boolean {
  if (!current) {
    return true;
  }

  if (next.score !== current.score) {
    return next.score > current.score;
  }

  if (seedDate) {
    const nextExact = effectiveEventDate(next.market) === seedDate;
    const currentExact = effectiveEventDate(current.market) === seedDate;
    if (nextExact !== currentExact) {
      return nextExact;
    }
  }

  return next.market.volume > current.market.volume;
}

function buildPolymarketIndex(catalog: NormalizedMarket[]): PolymarketIndex {
  const entries: IndexedPolymarket[] = catalog.map((market) => ({
    market,
    meta: buildMarketMeta(market.title),
  }));

  const byToken = new Map<string, number[]>();
  const sportsH2HByDate = new Map<string, number[]>();

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    for (const token of entry.meta.tokens) {
      const bucket = byToken.get(token);
      if (bucket) {
        bucket.push(index);
      } else {
        byToken.set(token, [index]);
      }
    }

    if (!isHeadToHeadWinnerMeta(entry.meta)) {
      continue;
    }

    const date = effectiveEventDate(entry.market);
    if (!date) {
      continue;
    }

    const bucket = sportsH2HByDate.get(date);
    if (bucket) {
      bucket.push(index);
    } else {
      sportsH2HByDate.set(date, [index]);
    }
  }

  return { entries, byToken, sportsH2HByDate };
}

function buildStrategy(
  label: string,
  yesMarket: NormalizedMarket,
  noMarket: NormalizedMarket
): ArbitrageStrategy | null {
  if (yesMarket.yesAsk === null || noMarket.noAsk === null) {
    return null;
  }

  const totalCost = yesMarket.yesAsk + noMarket.noAsk;
  const profit = 1 - totalCost;

  return {
    label,
    yesPlatform: yesMarket.platform,
    noPlatform: noMarket.platform,
    yesPrice: yesMarket.yesAsk,
    noPrice: noMarket.noAsk,
    totalCost,
    profit,
  };
}

function computeBestProfit(kalshi: NormalizedMarket, poly: NormalizedMarket): number | null {
  if (
    kalshi.yesAsk === null ||
    kalshi.noAsk === null ||
    poly.yesAsk === null ||
    poly.noAsk === null
  ) {
    return null;
  }

  return Math.max(
    1 - (kalshi.yesAsk + poly.noAsk),
    1 - (poly.yesAsk + kalshi.noAsk)
  );
}

function isHeadToHeadWinnerMeta(meta: MarketMeta): boolean {
  if (meta.category !== 'winner' || meta.hasSecondHalf || meta.hasOvertime) {
    return false;
  }

  return (
    /\bvs\.?\b|\bversus\b/i.test(meta.normalized) ||
    /\b at \b/i.test(meta.normalized)
  );
}

function findSportsSlugCandidateIndices(seed: SeedEntry, index: PolymarketIndex): number[] {
  if (!isHeadToHeadWinnerMeta(seed.meta)) {
    return [];
  }

  const kalshiBlob = parseKalshiSportsTeamBlob(seed.market.eventId);
  const date = effectiveEventDate(seed.market);
  if (!kalshiBlob || !date) {
    return [];
  }

  const dateCandidates = index.sportsH2HByDate.get(date);
  if (!dateCandidates?.length) {
    return [];
  }

  const matches: number[] = [];
  for (const candidateIndex of dateCandidates) {
    const entry = index.entries[candidateIndex];
    if (!areSportsSlugTeamsCompatible(seed.market.eventId, entry.market.eventId)) {
      continue;
    }
    matches.push(candidateIndex);
  }

  return matches;
}

function findBestPolymarketMatch(
  seed: SeedEntry,
  index: PolymarketIndex,
  minMatchScore: number
): { market: NormalizedMarket; score: number } | null {
  if (seed.meta.tokens.size === 0) {
    return null;
  }

  const candidateIndices = new Set<number>();
  for (const token of seed.meta.tokens) {
    const matches = index.byToken.get(token);
    if (!matches) {
      continue;
    }
    for (const matchIndex of matches) {
      candidateIndices.add(matchIndex);
    }
  }

  for (const matchIndex of findSportsSlugCandidateIndices(seed, index)) {
    candidateIndices.add(matchIndex);
  }

  if (candidateIndices.size === 0) {
    return null;
  }

  let best: { market: NormalizedMarket; score: number } | null = null;
  const seedDate = effectiveEventDate(seed.market);

  for (const candidateIndex of candidateIndices) {
    const entry = index.entries[candidateIndex];
    const headToHead =
      isHeadToHeadWinnerMeta(seed.meta) && isHeadToHeadWinnerMeta(entry.meta);
    const entryDate = effectiveEventDate(entry.market);

    if (seedDate && entryDate && seedDate !== entryDate) {
      continue;
    }

    if (
      !areEventDatesCompatible(seedDate, entryDate, Boolean(headToHead && seedDate && entryDate))
    ) {
      continue;
    }

    if (!areMetaCompatible(seed.meta, entry.meta)) {
      continue;
    }

    const score = jaccardFromTokenSets(
      seed.meta.tokens,
      entry.meta.tokens,
      seed.meta.normalized,
      entry.meta.normalized
    );

    const sportsSlugMatch =
      headToHead &&
      seedDate !== null &&
      entryDate === seedDate &&
      areSportsSlugTeamsCompatible(seed.market.eventId, entry.market.eventId);

    const datesMatch = seedDate !== null && entryDate !== null && seedDate === entryDate;
    const titleMatch =
      isStrongTitleMatch(score, seed.meta, entry.meta, { datesMatch }) || sportsSlugMatch;

    if (!titleMatch) {
      continue;
    }

    const candidate = { market: entry.market, score };
    if (isBetterCandidate(seedDate, candidate, best)) {
      best = candidate;
    }
  }

  return best;
}

function buildStrategies(
  kalshiMarket: NormalizedMarket,
  polyMarket: NormalizedMarket
): ArbitrageStrategy[] {
  const strategies: ArbitrageStrategy[] = [];
  const strategyA = buildStrategy(
    'Buy Yes on Kalshi + Buy No on Polymarket',
    kalshiMarket,
    polyMarket
  );
  const strategyB = buildStrategy(
    'Buy Yes on Polymarket + Buy No on Kalshi',
    polyMarket,
    kalshiMarket
  );

  if (strategyA) {
    strategies.push(strategyA);
  }
  if (strategyB) {
    strategies.push(strategyB);
  }

  return strategies;
}

function buildOpportunity(
  kalshi: NormalizedMarket,
  poly: NormalizedMarket,
  matchScore: number,
  title: string,
  minProfit: number
): ArbitrageOpportunity | null {
  const strategies = buildStrategies(kalshi, poly);
  const profitableStrategies = strategies.filter((strategy) => strategy.profit >= minProfit);
  const bestStrategy = profitableStrategies.sort((a, b) => b.profit - a.profit)[0] ?? null;

  if (!bestStrategy) {
    return null;
  }

  return {
    matchScore,
    title,
    kalshi,
    polymarket: poly,
    strategies: profitableStrategies,
    bestProfit: bestStrategy.profit,
    bestStrategy,
  };
}

export function findArbitrageOpportunities(options: {
  kalshiMarkets: NormalizedMarket[];
  kalshiOpenMarketCount: number;
  polymarketMarkets: NormalizedMarket[];
  exchangeStatus: ExchangeStatus;
  minMatchScore?: number;
  minProfit?: number;
  maxResults?: number;
}): ArbitrageSnapshot {
  const minMatchScore = options.minMatchScore ?? DEFAULT_MIN_MATCH_SCORE;
  const minProfit = options.minProfit ?? DEFAULT_MIN_PROFIT;
  const maxResults = options.maxResults ?? 25;

  const polyIndex = buildPolymarketIndex(options.polymarketMarkets);
  const seeds: SeedEntry[] = options.kalshiMarkets.map((market) => ({
    market,
    meta: buildMarketMeta(market.title),
  }));

  const opportunities: ArbitrageOpportunity[] = [];
  const scanResults: ScanResult[] = [];
  const usedPolymarket = new Set<string>();

  for (const seed of seeds) {
    const match = findBestPolymarketMatch(seed, polyIndex, minMatchScore);
    const kalshiQuote = toQuote(seed.market);

    if (!match || usedPolymarket.has(match.market.id)) {
      scanResults.push({
        matchScore: null,
        title: seed.market.title,
        kalshi: kalshiQuote,
        polymarket: null,
        bestProfit: null,
      });
      continue;
    }

    const alignedKalshi = alignKalshiMarketToPolyYes(seed.market, match.market);
    const bestProfit = computeBestProfit(alignedKalshi, match.market);
    const title =
      seed.market.title.length >= match.market.title.length
        ? seed.market.title
        : match.market.title;

    usedPolymarket.add(match.market.id);
    scanResults.push({
      matchScore: match.score,
      title,
      kalshi: toQuote(alignedKalshi),
      polymarket: toQuote(match.market),
      bestProfit,
    });

    const opportunity = buildOpportunity(
      alignedKalshi,
      match.market,
      match.score,
      title,
      minProfit
    );
    if (opportunity) {
      opportunities.push(opportunity);
    }
  }

  scanResults.sort((a, b) => {
    const profitA = a.bestProfit ?? -Infinity;
    const profitB = b.bestProfit ?? -Infinity;
    if (profitB !== profitA) {
      return profitB - profitA;
    }
    return a.title.localeCompare(b.title);
  });
  opportunities.sort((a, b) => b.bestProfit - a.bestProfit);

  const matchedScanResults = scanResults.filter((row) => row.polymarket !== null);

  return {
    exchangeStatus: options.exchangeStatus,
    opportunities: opportunities.slice(0, maxResults),
    scanResults,
    scanResultsTotal: scanResults.length,
    scanOffset: 0,
    scanLimit: scanResults.length,
    kalshiMarketCount: options.kalshiMarkets.length,
    kalshiOpenMarketCount: options.kalshiOpenMarketCount,
    polymarketMarketCount: options.polymarketMarkets.length,
    matchedPairs: matchedScanResults.length,
    matchedScanResults,
    minProfitThreshold: minProfit,
    fetchedAt: new Date().toISOString(),
  };
}
