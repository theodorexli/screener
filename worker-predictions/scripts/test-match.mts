import { fetchKalshiSeedMarkets } from '../src/kalshi.ts';
import { fetchPolymarketCatalog } from '../src/polymarket.ts';
import { findArbitrageOpportunities } from '../src/arb.ts';
import { isLiveSportsMicroProp } from '../src/matching.ts';

const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';
const POLY = 'https://gamma-api.polymarket.com';

const polyCatalogSize = 2500;
const [kalshiFetch, poly] = await Promise.all([
  fetchKalshiSeedMarkets(KALSHI, 500),
  fetchPolymarketCatalog(POLY, polyCatalogSize),
]);
const kalshi = kalshiFetch.seeds;

const badSeeds = kalshi.filter(
  (m) =>
    isLiveSportsMicroProp(m.title) ||
    /\bwins by\b|\btotal runs\b|\bfirst \d+ innings\b|\bdouble double\b/i.test(m.title)
);
const eventIds = new Set(kalshi.map((m) => m.eventId));
console.log('Kalshi seeds:', kalshi.length, 'open on exchange:', kalshiFetch.openMarketCount, 'unique events:', eventIds.size, 'bad:', badSeeds.length);
if (badSeeds.length) {
  console.log('Bad seeds:', badSeeds.slice(0, 5).map((m) => m.title));
}
console.log('Poly catalog:', poly.length);
console.log('Sample Kalshi:', kalshi.slice(0, 5).map((m) => m.title));
console.log('Sample Poly:', poly.slice(0, 5).map((m) => m.title));

const snap = findArbitrageOpportunities({
  kalshiMarkets: kalshi,
  polymarketMarkets: poly,
  exchangeStatus: {
    kalshi: { exchangeActive: true, tradingActive: true, estimatedResumeTime: null },
    polymarket: { active: true },
  },
});

console.log('Matched pairs:', snap.matchedPairs);
console.log('Opportunities:', snap.opportunities.length);
const matched = snap.scanResults.filter((r) => r.polymarket);
console.log('All matches:');
for (const r of matched) {
  console.log(' ', r.kalshi.title.slice(0, 42), '->', r.polymarket?.title.slice(0, 42));
}
