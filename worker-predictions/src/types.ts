export interface NormalizedMarket {
  platform: 'kalshi' | 'polymarket';
  id: string;
  eventId: string;
  eventDate: string | null;
  title: string;
  yesAsk: number | null;
  noAsk: number | null;
  volume: number;
  url: string;
}

export interface MarketQuote {
  id: string;
  title: string;
  yesAsk: number;
  noAsk: number;
  url: string;
  eventDate: string | null;
}

export interface ArbitrageStrategy {
  label: string;
  yesPlatform: 'kalshi' | 'polymarket';
  noPlatform: 'kalshi' | 'polymarket';
  yesPrice: number;
  noPrice: number;
  totalCost: number;
  profit: number;
}

export interface ArbitrageOpportunity {
  matchScore: number;
  title: string;
  kalshi: NormalizedMarket;
  polymarket: NormalizedMarket;
  strategies: ArbitrageStrategy[];
  bestProfit: number;
  bestStrategy: ArbitrageStrategy | null;
}

export interface ExchangeStatus {
  kalshi: {
    exchangeActive: boolean;
    tradingActive: boolean;
    estimatedResumeTime?: string | null;
  };
}

export interface ScanResult {
  matchScore: number | null;
  title: string;
  kalshi: MarketQuote;
  polymarket: MarketQuote | null;
  bestProfit: number | null;
}

export interface ArbitrageSnapshot {
  exchangeStatus: ExchangeStatus;
  opportunities: ArbitrageOpportunity[];
  scanResults: ScanResult[];
  scanResultsTotal: number;
  scanOffset: number;
  scanLimit: number;
  kalshiMarketCount: number;
  kalshiOpenMarketCount: number;
  polymarketMarketCount: number;
  matchedPairs: number;
  matchedScanResults: ScanResult[];
  minProfitThreshold: number;
  fetchedAt: string;
}
