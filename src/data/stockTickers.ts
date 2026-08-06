export interface PriceHistory {
  date: string;
  price: number;
  vwap?: number;
}

export interface StockTicker {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap: number;
  rsi?: number;
  epsGrowth?: number;
  divYield?: number;
  sector?: string;
  macd?: number;
  vwap?: number;
  priceHistory?: PriceHistory[];
  logoUrl?: string;
}

export const stockTickers: StockTicker[] = [];

// Generate mock price history data for charts
export function generatePriceHistory(symbol: string, days: number = 30): Array<{ date: string; price: number }> {
  const basePrice = stockTickers.find(s => s.symbol === symbol)?.price || 100;
  const history: Array<{ date: string; price: number }> = [];
  const today = new Date();
  
  for (let i = days; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    
    // Generate realistic price movement with some volatility
    const volatility = (Math.random() - 0.5) * 0.02; // ±1% daily volatility
    const trend = (days - i) / days * 0.05; // Slight upward trend
    const price = basePrice * (1 + trend + volatility);
    
    history.push({
      date: date.toISOString().split('T')[0],
      price: Math.round(price * 100) / 100,
    });
  }
  
  return history;
}

