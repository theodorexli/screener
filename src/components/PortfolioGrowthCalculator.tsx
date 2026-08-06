import { useState, useEffect, useMemo } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { format } from "date-fns";
import { type StockTicker } from "@/data/stockTickers";
import { cn, getCache, setCache } from "@/lib/utils";

interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
}

interface PortfolioGrowthCalculatorProps {
  watchlist: StockTicker[];
  symbolMetadata?: Record<string, { longName?: string; website?: string; allocateAgressive?: number }>;
  height?: number; // Height to match ticker details
  totalSymbolsCount?: number; // Total number of symbols in watchlist from Notion (not just loaded stocks)
  watchlists?: Watchlist[]; // All watchlists for background fetching
  activeWatchlistId?: string; // Active watchlist ID for prioritizing
}

interface HistoricalPrice {
  symbol: string;
  date: string;
  close: number;
}

const INITIAL_INVESTMENT = 10000;

export function PortfolioGrowthCalculator({ 
  watchlist, 
  symbolMetadata,
  height,
  totalSymbolsCount,
  watchlists,
  activeWatchlistId
}: PortfolioGrowthCalculatorProps) {
  // Ensure symbolMetadata is never undefined
  const safeSymbolMetadata = symbolMetadata || {};
  
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(() => {
    // Default to January 2nd of the current year (Jan 1 is usually a holiday)
    const date = new Date();
    date.setMonth(0, 2); // January (month 0), day 2
    date.setHours(0, 0, 0, 0);
    return date;
  });
  
  // Function to check if a date is a US market holiday or weekend
  const isMarketHoliday = (date: Date): boolean => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();
    const dayOfWeek = date.getDay();
    
    // Weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) return true;
    
    // New Year's Day (Jan 1)
    if (month === 0 && day === 1) return true;
    
    // Martin Luther King Jr. Day (3rd Monday of January)
    if (month === 0 && dayOfWeek === 1 && day >= 15 && day <= 21) return true;
    
    // Presidents' Day (3rd Monday of February)
    if (month === 1 && dayOfWeek === 1 && day >= 15 && day <= 21) return true;
    
    // Memorial Day (last Monday of May)
    if (month === 4 && dayOfWeek === 1) {
      const lastDayOfMay = new Date(year, 5, 0).getDate();
      const lastMonday = lastDayOfMay - ((lastDayOfMay - day) % 7);
      if (day === lastMonday) return true;
    }
    
    // Juneteenth (June 19)
    if (month === 5 && day === 19) return true;
    
    // Independence Day (July 4)
    if (month === 6 && day === 4) return true;
    
    // Labor Day (1st Monday of September)
    if (month === 8 && dayOfWeek === 1 && day <= 7) return true;
    
    // Thanksgiving (4th Thursday of November)
    if (month === 10 && dayOfWeek === 4 && day >= 22 && day <= 28) return true;
    
    // Christmas (Dec 25)
    if (month === 11 && day === 25) return true;
    
    return false;
  };
  const [historicalPrices, setHistoricalPrices] = useState<Record<string, HistoricalPrice>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);

  // Fetch historical prices - prioritize active watchlist, then fetch others in background
  useEffect(() => {
    if (!selectedDate || watchlist.length === 0) {
      setHistoricalPrices({});
      return;
    }

    let isCancelled = false;
    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

    // Helper function to fetch historical prices for a list of symbols
    const fetchHistoricalPricesForSymbols = async (symbols: string[]): Promise<Record<string, HistoricalPrice>> => {
      if (symbols.length === 0) return {};

      const sortedSymbols = [...symbols].sort();
      const cacheKey = `historical-prices-${dateStr}-${sortedSymbols.join(',')}`;
      
      // Check cache first
      const cachedPrices = getCache<Record<string, HistoricalPrice>>(cacheKey, CACHE_DURATION);
      if (cachedPrices) {
        return cachedPrices;
      }

      const prices: Record<string, HistoricalPrice> = {};

      try {
        const symbolsParam = symbols.join(',');
        const baseUrl = import.meta.env.VITE_WORKER_URL || '';
        const url = `${baseUrl}/api/historical-price?symbols=${encodeURIComponent(symbolsParam)}&date=${dateStr}`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
          return prices; // Return empty on error
        }
        
        const result = await response.json();
        
        if (result.success && result.data) {
          Object.keys(result.data).forEach((symbol) => {
            const priceData = result.data[symbol];
            if (priceData && priceData.close) {
              prices[symbol] = {
                symbol: symbol,
                date: priceData.date,
                close: priceData.close
              };
            }
          });
          
          // Cache the results
          setCache(cacheKey, prices);
        }
      } catch (err) {
        // Silently fail for background fetches
      }

      return prices;
    };

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      // Get symbols from current active watchlist
      const activeSymbols = watchlist
        .filter(stock => stock.symbol && stock.symbol.trim().length > 0)
        .map(stock => stock.symbol.trim().toUpperCase());
      
      if (activeSymbols.length === 0) {
        setHistoricalPrices({});
        setIsLoading(false);
        return;
      }

      // PRIORITY: Fetch active watchlist first
      const activePrices = await fetchHistoricalPricesForSymbols(activeSymbols);
      
      if (isCancelled) return;

      // Set active watchlist prices immediately
      setHistoricalPrices(activePrices);
      setIsLoading(false);

      // BACKGROUND: Fetch other watchlists if available
      if (watchlists && activeWatchlistId && watchlists.length > 1) {
        // Get all symbols from other watchlists
        const otherWatchlists = watchlists.filter(wl => wl.id !== activeWatchlistId);
        const allOtherSymbols = new Set<string>();
        
        otherWatchlists.forEach(wl => {
          wl.symbols.forEach(symbol => {
            const upperSymbol = symbol.trim().toUpperCase();
            if (upperSymbol && !activeSymbols.includes(upperSymbol)) {
              allOtherSymbols.add(upperSymbol);
            }
          });
        });

        // Fetch other watchlists in background (non-blocking)
        if (allOtherSymbols.size > 0) {
          const otherSymbolsArray = Array.from(allOtherSymbols);
          // Fetch in batches to avoid overwhelming the API
          const batchSize = 20;
          for (let i = 0; i < otherSymbolsArray.length; i += batchSize) {
            if (isCancelled) break;
            const batch = otherSymbolsArray.slice(i, i + batchSize);
            await fetchHistoricalPricesForSymbols(batch);
            // Small delay between batches
            if (i + batchSize < otherSymbolsArray.length) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }
        }
      }
    };

    fetchData();
    
    return () => {
      isCancelled = true;
    };
  }, [selectedDate, watchlist.map(s => s.symbol).join(','), watchlists, activeWatchlistId]);

  // Calculate portfolio allocation and values
  const portfolioData = useMemo(() => {
    if (!selectedDate) {
      return null;
    }

    if (Object.keys(historicalPrices).length === 0) {
      return null;
    }

    // Check that ALL stocks have valid current prices (not just historical prices)
    // This ensures we don't show partial/incomplete portfolio values
    const stocksWithValidCurrentPrice = watchlist.filter(
      stock => stock.price && stock.price > 0 && isFinite(stock.price)
    );
    
    // Only show portfolio value if ALL stocks have loaded their current price data
    if (stocksWithValidCurrentPrice.length !== watchlist.length) {
      return null; // Not all ticker data has loaded yet
    }

    // Filter stocks that have both historical prices AND valid current prices
    const validStocks = watchlist.filter(
      stock => historicalPrices[stock.symbol] && 
               stock.price && stock.price > 0 && isFinite(stock.price)
    );
    
    if (validStocks.length === 0) {
      return null;
    }

    // Only show results if we have data for at least 30% of stocks
    // This prevents showing misleading results when most stocks are missing data
    const dataCoveragePercent = (validStocks.length / watchlist.length) * 100;
    if (dataCoveragePercent < 30) {
      return null; // Not enough data to show accurate results
    }

    // IMPORTANT: Use the FULL watchlist symbol count from Notion (not just loaded stocks)
    // The total portfolio is $10,000 split across ALL symbols in the watchlist configuration
    const totalStocksInWatchlist = totalSymbolsCount ?? watchlist.length;

    // Calculate weights: use allocateAgressive percentage if available, otherwise equal weight
    let weights: Record<string, number> = {};
    const stocksWithAllocateAgressive: string[] = [];
    let totalAllocateAgressive = 0;
    
    // First pass: collect stocks with allocateAgressive values
    watchlist.forEach(stock => {
      // Check both uppercase and original case for symbol matching
      const symbolUpper = stock.symbol.toUpperCase();
      const allocateAgressive = safeSymbolMetadata[stock.symbol]?.allocateAgressive || 
                                safeSymbolMetadata[symbolUpper]?.allocateAgressive;
      if (allocateAgressive !== undefined && allocateAgressive > 0) {
        // Treat as percentage: if > 1, assume it's a percentage (e.g., 15 = 15%), otherwise assume decimal (e.g., 0.15 = 15%)
        const percentage = allocateAgressive > 1 ? allocateAgressive / 100 : allocateAgressive;
        weights[stock.symbol] = percentage;
        stocksWithAllocateAgressive.push(stock.symbol);
        totalAllocateAgressive += percentage;
      }
    });
    
    // If we have allocateAgressive values, use them directly as percentages
    // For stocks without allocateAgressive, distribute remaining allocation equally
    if (stocksWithAllocateAgressive.length > 0) {
      const remainingAllocation = Math.max(0, 1 - totalAllocateAgressive);
      const stocksWithoutAllocateAgressive = watchlist.filter(
        stock => !stocksWithAllocateAgressive.includes(stock.symbol)
      );
      
      if (stocksWithoutAllocateAgressive.length > 0 && remainingAllocation > 0) {
        const equalWeightForRemaining = remainingAllocation / stocksWithoutAllocateAgressive.length;
        stocksWithoutAllocateAgressive.forEach(stock => {
          weights[stock.symbol] = equalWeightForRemaining;
        });
      }
    } else {
      // No allocateAgressive values: use equal weight for all
      const equalWeight = 1 / totalStocksInWatchlist;
      watchlist.forEach(stock => {
        weights[stock.symbol] = equalWeight;
      });
    }

    // Calculate shares and portfolio values
    const holdings: Array<{
      symbol: string;
      shares: number;
      priceAtDate: number;
      valueAtDate: number;
      currentPrice: number;
      currentValue: number;
      weight: number;
    }> = [];

    validStocks.forEach(stock => {
      const historicalPrice = historicalPrices[stock.symbol];
      if (!historicalPrice) return;

      // Skip stocks with invalid current price (must be > 0)
      if (!stock.price || stock.price <= 0 || !isFinite(stock.price)) {
        return;
      }

      // Validate historical price
      if (!historicalPrice.close || historicalPrice.close <= 0 || !isFinite(historicalPrice.close)) {
        return;
      }

      // Initial amount per stock = (1 / total tickers) * 10000 for equal weight
      // Or weight * 10000 if using aggressive weights
      const initialAmount = weights[stock.symbol] * INITIAL_INVESTMENT;
      
      // Number of shares = initial amount / stock price at selected date
      const shares = initialAmount / historicalPrice.close;
      
      // Validate shares calculation
      if (!isFinite(shares) || shares <= 0) {
        return;
      }
      
      // Current value = today's stock price * number of shares
      const currentValue = stock.price * shares;
      
      // Validate current value
      if (!isFinite(currentValue) || currentValue < 0) {
        return;
      }

      holdings.push({
        symbol: stock.symbol,
        shares,
        priceAtDate: historicalPrice.close,
        valueAtDate: initialAmount, // This is what we invested
        currentPrice: stock.price,
        currentValue,
        weight: weights[stock.symbol] * 100 // Convert to percentage
      });
    });

    // Calculate current portfolio value (sum of all current values)
    const currentPortfolioValue = holdings.reduce((sum, h) => sum + h.currentValue, 0);
    // Always compare against the full $10,000 initial investment
    // The portfolio assumes $10,000 total, even if some stocks don't have historical data
    const totalReturn = currentPortfolioValue - INITIAL_INVESTMENT;
    const totalReturnPercent = (totalReturn / INITIAL_INVESTMENT) * 100;

    // Determine if using aggressive weight or equal weight
    const isAggressiveWeight = stocksWithAllocateAgressive.length > 0;

    return {
      holdings,
      currentPortfolioValue,
      totalReturn,
      totalReturnPercent,
      isAggressiveWeight
    };
  }, [selectedDate, historicalPrices, watchlist, safeSymbolMetadata, totalSymbolsCount]);

  // Determine if using aggressive weight based on symbolMetadata (not dependent on portfolioData)
  const isUsingAggressiveWeight = useMemo(() => {
    const hasAggressive = watchlist.some(stock => {
      // Check both uppercase and original case for symbol matching
      const symbolUpper = stock.symbol.toUpperCase();
      const meta1 = safeSymbolMetadata[stock.symbol];
      const meta2 = safeSymbolMetadata[symbolUpper];
      const allocateAgressive = meta1?.allocateAgressive ?? meta2?.allocateAgressive;
      
      if (allocateAgressive !== undefined && allocateAgressive > 0) {
        return true;
      }
      return false;
    });
    return hasAggressive;
  }, [watchlist, safeSymbolMetadata]);

  return (
    <div 
      className="border-b bg-background w-full overflow-hidden"
      style={height ? { height: `${height}px` } : undefined}
    >
      <div className="px-4 py-3 w-full min-w-0 max-w-full h-full flex flex-col justify-center">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <span className="text-sm font-semibold">
               Portfolio value since{' '}
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    className={cn(
                      "text-sm text-muted-foreground hover:text-foreground transition-colors underline decoration-dotted underline-offset-2 cursor-pointer font-semibold p-0 m-0 leading-none inline align-baseline",
                      !selectedDate && "text-muted-foreground"
                    )}
                  >
                    {selectedDate ? format(selectedDate, "PPP") : "Pick a date"}
                  </button>
                </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  defaultMonth={selectedDate}
                  captionLayout="dropdown"
                  fromYear={2022}
                  toYear={new Date().getFullYear()}
                  disabled={(date) =>
                    date > new Date() || date < new Date("1900-01-01") || isMarketHoliday(date)
                  }
                  initialFocus
                />
              </PopoverContent>
              </Popover>
              <TooltipProvider delayDuration={0}>
                <Tooltip open={isTooltipOpen} onOpenChange={setIsTooltipOpen}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center h-3.5 w-3.5 text-muted-foreground cursor-help align-middle ml-1 touch-manipulation focus:outline-none"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsTooltipOpen(!isTooltipOpen);
                      }}
                      onTouchStart={(e) => {
                        e.stopPropagation();
                        setIsTooltipOpen(true);
                      }}
                      aria-label="Portfolio calculation info"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    className="text-xs px-2 py-1 z-50 max-w-[250px]"
                    onPointerDownOutside={() => setIsTooltipOpen(false)}
                  >
                    <p className="font-normal">
                      Assuming a hypothetical <span className="font-bold">{isUsingAggressiveWeight ? 'aggressive' : 'equal-weight'}</span> starting portfolio value of $10,000
                      {/* Debug: {JSON.stringify({isUsingAggressiveWeight, symbolMetadataKeys: Object.keys(symbolMetadata).length, watchlistSymbols: watchlist.map(s => s.symbol)})} */}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
          </div>
          {isLoading ? (
            <div className="flex flex-col items-end gap-1">
              <div className="h-7 w-24 bg-muted animate-pulse rounded" />
              <div className="h-3 w-20 bg-muted animate-pulse rounded" />
            </div>
          ) : error ? (
            <div className="text-xs text-red-600">{error}</div>
          ) : portfolioData ? (
            <div className="text-right">
              <div className="text-2xl font-semibold">
                ${portfolioData.currentPortfolioValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className={cn(
                "text-xs mt-0.5 tabular-nums",
                portfolioData.totalReturnPercent >= 0 ? "text-green-600" : "text-red-600"
              )}>
                {portfolioData.totalReturnPercent >= 0 ? "+" : ""}
                {portfolioData.totalReturnPercent.toFixed(2)}%
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-end gap-1">
              <div className="h-7 w-24 bg-muted animate-pulse rounded" />
              <div className="h-3 w-20 bg-muted animate-pulse rounded" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

