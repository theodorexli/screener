import { useState, useMemo, useEffect } from "react";
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { generatePriceHistory, type StockTicker } from "@/data/stockTickers";
import { HelpCircle, BarChart3, ExternalLink } from "lucide-react";

interface StockChartProps {
  selectedStock: StockTicker | null;
  symbolMetadata?: Record<string, { longName?: string; website?: string }>;
  isChartCollapsed?: boolean;
  setIsChartCollapsed?: (collapsed: boolean) => void;
}

type TimeFilter = "1D" | "5D" | "1M" | "3M" | "6M" | "1Y";

const timeFilterDays: Record<TimeFilter, number> = {
  "1D": 1,
  "5D": 5,
  "1M": 30,
  "3M": 90,
  "6M": 180,
  "1Y": 365,
};

// Calculate EMA (Exponential Moving Average)
function calculateEMA(data: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const ema: (number | null)[] = [];
  
  // Start with SMA for the first value
  let sum = 0;
  for (let i = 0; i < period && i < data.length; i++) {
    sum += data[i];
    ema.push(null); // Not enough data yet
  }
  
  if (data.length >= period) {
    ema[period - 1] = sum / period;
    
    // Calculate EMA for remaining values
    for (let i = period; i < data.length; i++) {
      ema[i] = data[i] * k + ema[i - 1]! * (1 - k);
    }
  }
  
  return ema;
}

const chartConfig = {
  price: {
    label: "Price",
    color: "hsl(var(--primary))",
  },
  ema9: {
    label: "EMA 9",
    color: "#8b5cf6",
  },
  ema21: {
    label: "EMA 21",
    color: "#06b6d4",
  },
  ema50: {
    label: "EMA 50",
    color: "#f59e0b",
  },
  ema100: {
    label: "EMA 100",
    color: "#10b981",
  },
  ema200: {
    label: "EMA 200",
    color: "#ef4444",
  },
  vwap: {
    label: "VWAP",
    color: "#f97316",
  },
};

export function StockChart({ selectedStock, symbolMetadata, isChartCollapsed, setIsChartCollapsed }: StockChartProps) {
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("1M");
  const [logoError, setLogoError] = useState<boolean>(false);

  const chartData = useMemo(() => {
    if (!selectedStock) return [];
    
    const displayStock = selectedStock;
    
    // Use real price history from API if available, otherwise generate mock data
    let fullPriceHistory;
    if (displayStock.priceHistory && displayStock.priceHistory.length > 0) {
      fullPriceHistory = displayStock.priceHistory;
    } else {
      // Fallback to generated data
      fullPriceHistory = generatePriceHistory(displayStock.symbol, 30);
    }
    
    // Calculate EMAs from ALL available data (not filtered)
    const allPrices = fullPriceHistory.map(d => d.price);
    const ema9 = calculateEMA(allPrices, 9);
    const ema21 = calculateEMA(allPrices, 21);
    const ema50 = calculateEMA(allPrices, 50);
    const ema100 = calculateEMA(allPrices, 100);
    const ema200 = calculateEMA(allPrices, 200);
    
    // Add EMAs to all data points
    const dataWithEMAs = fullPriceHistory.map((point, index) => ({
      ...point,
      ema9: ema9[index],
      ema21: ema21[index],
      ema50: ema50[index],
      ema100: ema100[index],
      ema200: ema200[index],
    }));
    
    // NOW filter by time period for display
    const daysToShow = Math.min(timeFilterDays[timeFilter], dataWithEMAs.length);
    const filteredData = dataWithEMAs.slice(-daysToShow);
    
    return filteredData;
  }, [selectedStock, timeFilter]);

  const displayStock = selectedStock;
  const currentPrice = displayStock?.price ?? 0;
  const change = displayStock?.change ?? 0;
  const changePercent = displayStock?.changePercent ?? 0;
  
  // Use logoUrl from stock data, or construct from ticker endpoint (per logo.dev docs)
  // The ticker endpoint works best for stock symbols - no website needed
  const logoUrl = displayStock?.logoUrl || (displayStock
    ? `${import.meta.env.VITE_WORKER_URL || ''}/api/logos/${encodeURIComponent(displayStock.symbol)}`
    : undefined);
  
  // Reset logo error when stock changes
  useEffect(() => {
    setLogoError(false);
  }, [displayStock?.symbol, logoUrl]);

  // Render website link if available
  // Check symbolMetadata first, with fallback for SPY default
  const websiteUrl = displayStock 
    ? (symbolMetadata?.[displayStock.symbol]?.website || 
       (displayStock.symbol === 'SPY' ? 'https://www.ssga.com/us/en/intermediary/etfs/spdr-sp-500-etf-trust-spy' : undefined))
    : undefined;
  
  const websiteLink = displayStock && websiteUrl ? (() => {
    try {
      // Ensure URL has protocol
      const fullUrl = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
      const url = new URL(fullUrl);
      const hostname = url.hostname.replace('www.', '');
      return (
        <>
          {/* Mobile: Icon with tooltip */}
          <TooltipProvider>
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <a
                  href={fullUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sm:hidden inline-flex items-center justify-center ml-1.5 text-primary hover:text-primary/80"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs px-2 py-1 z-50">
                <p className="font-normal">{hostname}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {/* Desktop: Text link */}
          <a
            href={fullUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline text-primary hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {hostname}
          </a>
        </>
      );
    } catch {
      // Invalid URL, just show as text on desktop, icon on mobile
      return (
        <>
          <TooltipProvider>
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <span className="sm:hidden inline-flex items-center justify-center ml-1.5 text-primary">
                  <ExternalLink className="w-3.5 h-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs px-2 py-1 z-50">
                <p className="font-normal">{websiteUrl}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <span className="hidden sm:inline text-primary">
            {websiteUrl}
          </span>
        </>
      );
    }
  })() : null;

  const isPlaceholder = displayStock && displayStock.price === 0 && displayStock.change === 0 && displayStock.changePercent === 0;

  return (
    <div className="w-full min-w-0">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {logoUrl && !logoError ? (
            <img
              src={logoUrl}
              alt={`${displayStock?.symbol || 'Stock'} logo`}
              className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
              onError={() => {
                setLogoError(true);
              }}
            />
          ) : displayStock ? (
            <div 
              className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 text-gray-400"
            >
              <HelpCircle className="w-6 h-6" />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-lg bg-muted animate-pulse flex-shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            {displayStock ? (
              <h1 className="text-2xl font-semibold tracking-tight">
                {displayStock.symbol}
              </h1>
            ) : (
              <div className="h-7 w-12 sm:w-16 bg-muted rounded animate-pulse" />
            )}
            <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1 sm:gap-2">
              {displayStock ? (
                <>
                  <span className="truncate max-w-[calc(100%-2rem)] sm:max-w-none">
                    {symbolMetadata?.[displayStock.symbol]?.longName || displayStock.name}
                  </span>
                  {websiteLink}
                </>
              ) : (
                <>
                  <span className="h-3 w-16 sm:w-24 bg-muted rounded animate-pulse inline-block" />
                  <span className="h-3 w-12 sm:w-20 bg-muted rounded animate-pulse inline-block" />
                </>
              )}
            </div>
          </div>
        </div>
        <div className="text-right flex items-center gap-2 flex-shrink-0">
          <div>
            {displayStock && !isPlaceholder ? (
              <>
                <div className="text-2xl font-semibold">
                  ${currentPrice.toFixed(2)}
                </div>
                <div className={`text-xs mt-0.5 ${change >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {change >= 0 ? "+" : ""}{change.toFixed(2)} ({change >= 0 ? "+" : ""}{changePercent.toFixed(2)}%)
                </div>
              </>
            ) : (
              <>
                <div className="h-7 w-16 sm:w-20 bg-muted rounded animate-pulse mb-1" />
                <div className="h-3 w-12 sm:w-16 bg-muted rounded animate-pulse" />
              </>
            )}
          </div>
          {/* Show Chart button - always visible when setIsChartCollapsed is provided */}
          {setIsChartCollapsed !== undefined && (
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={!isChartCollapsed ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setIsChartCollapsed(!isChartCollapsed)}
                    className={`w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0 p-0 border border-border ${
                      !isChartCollapsed 
                        ? "hover:!bg-primary/90 dark:hover:!bg-primary/80" 
                        : "hover:bg-accent"
                    }`}
                    aria-label={!isChartCollapsed ? "Hide Chart" : "Show Chart"}
                  >
                    <BarChart3 className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs px-2 py-1 z-50">
                  <p>{!isChartCollapsed ? "Hide Chart" : "Show Chart"}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>

      {/* Collapsible chart section with smooth transition */}
      <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isChartCollapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'} grid`}>
        <div className="min-h-0">
          {!isChartCollapsed && selectedStock && (
            <div className="flex gap-1 items-center mt-4">
              {/* Only show time filters we have data for (currently ~28 trading days from API) */}
              {(["5D", "1M"] as TimeFilter[]).map((filter) => (
                <Button
                  key={filter}
                  variant={timeFilter === filter ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setTimeFilter(filter)}
                  className="h-6 text-xs px-2"
                >
                  {filter}
                </Button>
              ))}
              <div className="text-xs text-muted-foreground ml-2 flex items-center">
                (Limited to ~28 days of historical data)
              </div>
            </div>
          )}

          {!isChartCollapsed && selectedStock && chartData.length > 0 && (
            <div className="w-full min-w-[1px] max-w-full overflow-hidden min-h-[300px]">
            <ChartContainer config={chartConfig} className="h-[300px] sm:h-[400px] w-full max-w-full mt-4 min-w-[1px] min-h-[300px]">
          <ComposedChart key={`${displayStock?.symbol ?? 'unknown'}-${timeFilter}`} data={chartData}>
          <defs>
            <linearGradient id="fillPrice" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor="var(--color-price)"
                stopOpacity={0.8}
              />
              <stop
                offset="95%"
                stopColor="var(--color-price)"
                stopOpacity={0.1}
              />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(value) => {
              const date = new Date(value);
              return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
            }}
          />
          <YAxis
            yAxisId="price"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            domain={["dataMin - 5", "dataMax + 5"]}
            tickFormatter={(value) => `$${value.toFixed(0)}`}
          />
          <ChartTooltip 
            content={<ChartTooltipContent 
              indicator="dot"
              labelFormatter={(label) => {
                const date = new Date(label);
                return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
              }}
            />} 
          />
          <Area
            yAxisId="price"
            type="monotone"
            dataKey="price"
            stroke="var(--color-price)"
            fill="url(#fillPrice)"
            strokeWidth={2}
            fillOpacity={1}
          />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="ema9"
            stroke="var(--color-ema9)"
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="ema21"
            stroke="var(--color-ema21)"
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="ema50"
            stroke="var(--color-ema50)"
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="ema100"
            stroke="var(--color-ema100)"
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="ema200"
            stroke="var(--color-ema200)"
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="vwap"
            stroke="var(--color-vwap)"
            strokeWidth={2}
            dot={false}
            strokeDasharray="5 5"
            connectNulls
          />
        </ComposedChart>
      </ChartContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

