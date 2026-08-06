import { useState, useCallback, useEffect } from "react";
import { type StockTicker } from "@/data/stockTickers";
import { PortfolioGrowthCalculator } from "@/components/PortfolioGrowthCalculator";
import { Bookmark } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
}

interface StockHeatmapProps {
  onStockSelect: (stock: StockTicker) => void;
  selectedStock: StockTicker | null;
  watchlist: StockTicker[];
  isLoading?: boolean;
  sidebarSize?: number;
  symbolMetadata?: Record<string, { longName?: string; website?: string; allocateAgressive?: number }>;
  totalSymbolsCount?: number; // Total number of symbols in watchlist from Notion
  watchlists?: Watchlist[]; // All watchlists for background fetching
  activeWatchlistId?: string; // Active watchlist ID for prioritizing
}

// Calculate background color based on change percentage
function getBackgroundColor(changePercent: number): string {
  // No change - gray
  if (Math.abs(changePercent) < 0.01) {
    return "bg-gray-200 dark:bg-gray-700";
  }

  // Positive change - green gradient
  if (changePercent > 0) {
    // Scale from very green (high positive) to light green (low positive)
    // Use absolute value to determine intensity
    const intensity = Math.min(Math.abs(changePercent) / 10, 1); // Cap at 10% for max intensity
    
    if (intensity > 0.7) {
      return "bg-green-600 dark:bg-green-700"; // Very green
    } else if (intensity > 0.5) {
      return "bg-green-500 dark:bg-green-600";
    } else if (intensity > 0.3) {
      return "bg-green-400 dark:bg-green-500";
    } else if (intensity > 0.15) {
      return "bg-green-300 dark:bg-green-400";
    } else {
      return "bg-green-200 dark:bg-green-300"; // Light green
    }
  }

  // Negative change - red gradient
  if (changePercent < 0) {
    // Scale from very red (high negative) to light red (low negative)
    const intensity = Math.min(Math.abs(changePercent) / 10, 1); // Cap at 10% for max intensity
    
    if (intensity > 0.7) {
      return "bg-red-600 dark:bg-red-700"; // Very red
    } else if (intensity > 0.5) {
      return "bg-red-500 dark:bg-red-600";
    } else if (intensity > 0.3) {
      return "bg-red-400 dark:bg-red-500";
    } else if (intensity > 0.15) {
      return "bg-red-300 dark:bg-red-400";
    } else {
      return "bg-red-200 dark:bg-red-300"; // Light red
    }
  }

  return "bg-gray-200 dark:bg-gray-700";
}

// Determine text color - green if positive, otherwise default
function getTextColor(changePercent: number, change: number): string {
  // If percent change OR dollar change is positive, make all text green
  if (changePercent > 0 || change > 0) {
    return "text-green-800 dark:text-green-100";
  }
  // If both are negative, make text red
  if (changePercent < 0 && change < 0) {
    return "text-red-800 dark:text-red-100";
  }
  // No change or mixed - default text color
  return "text-gray-900 dark:text-gray-100";
}

function StockHeatmapComponent({ onStockSelect, selectedStock, watchlist, isLoading = false, sidebarSize = 20, symbolMetadata, totalSymbolsCount, watchlists = [], activeWatchlistId }: StockHeatmapProps) {
  // Use the prop directly - if undefined, use empty object
  const metadata = symbolMetadata || {};
  const [isMobile, setIsMobile] = useState(false);
  const [openTooltipSymbol, setOpenTooltipSymbol] = useState<string | null>(null);

  // Detect mobile screen size
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 1024; // lg breakpoint
      setIsMobile(mobile);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Find other watchlists that contain this symbol
  const getOtherWatchlists = useCallback((symbol: string): Array<{ id: string; name: string }> => {
    if (!watchlists.length || !activeWatchlistId) return [];
    
    const symbolUpper = symbol.toUpperCase();
    const otherWatchlists = watchlists
      .filter(wl => {
        // Exclude current watchlist
        if (wl.id === activeWatchlistId) return false;
        // Check if symbol exists in this watchlist's symbols array
        if (!wl.symbols || !Array.isArray(wl.symbols)) return false;
        // Case-insensitive comparison - check if any symbol in the array matches
        return wl.symbols.some(s => String(s).toUpperCase() === symbolUpper);
      })
      .map(wl => ({ id: wl.id, name: wl.name }));
    
    return otherWatchlists;
  }, [watchlists, activeWatchlistId]);

  // Responsive columns:
  // - Mobile (small): 2 columns (default, < 480px)
  // - Tablet (medium): 3 columns (480px+)
  // - Large mobile/tablet: 4 columns (md: 768px+) - works until 1024px when desktop layout kicks in
  // - Desktop (lg and above): uses sidebarSize logic for resizable panels
  // 
  // Note: Desktop layout starts at lg (1024px), so mobile can use md (768px) for 4 columns
  
  let columns = 2; // Default for mobile
  let gridClass = 'grid-cols-2 min-[480px]:grid-cols-3 md:grid-cols-4';
  
  // On desktop (lg and above), check if we should use sidebarSize logic
  // Only override if sidebarSize is meaningful (not the default mobile case)
  if (typeof window !== 'undefined' && window.innerWidth >= 1024 && sidebarSize !== 100) {
    if (sidebarSize >= 40) {
      columns = 4;
      gridClass = 'grid-cols-4';
    } else if (sidebarSize < 25) {
      columns = 2;
      gridClass = 'grid-cols-2';
    } else {
      columns = 3;
      gridClass = 'grid-cols-3';
    }
  } else {
    // Mobile/tablet: use responsive Tailwind classes
    // 2 cols (default) -> 3 cols (480px+) -> 4 cols (md: 768px+)
    // This works until 1024px when desktop layout takes over
    gridClass = 'grid-cols-2 min-[480px]:grid-cols-3 md:grid-cols-4';
    // For skeleton calculation on mobile
    if (typeof window !== 'undefined') {
      if (window.innerWidth >= 768) {
        columns = 4;
      } else if (window.innerWidth >= 480) {
        columns = 3;
      } else {
        columns = 2;
      }
    }
  }
  
  return (
    <div className="flex-1 mt-0 overflow-hidden flex flex-col">
      {/* Portfolio Growth Calculator */}
      <PortfolioGrowthCalculator
        watchlist={watchlist}
        symbolMetadata={metadata}
        height={60}
        totalSymbolsCount={totalSymbolsCount}
        watchlists={watchlists}
        activeWatchlistId={activeWatchlistId}
      />
      <div className="w-full h-full overflow-y-auto">
      <TooltipProvider>
      <div className={`grid ${gridClass} auto-rows-fr gap-0.5 p-0.5`}>
        {isLoading && watchlist.length === 0 ? (
          // Show skeleton cards while loading - visible blocks with borders, same structure as real blocks
          Array.from({ length: columns * 6 }).map((_, index) => (
            <div
              key={`skeleton-${index}`}
              className="flex flex-col justify-between p-4 border-2 border-muted-foreground/10"
            >
              {/* Ticker - Large (matches actual block) */}
              <div className="h-8 w-16 bg-muted rounded animate-pulse mb-2" />
              
              {/* Price, Percent Change, Dollar Change (matches actual block structure) */}
              <div className="space-y-1">
                <div className="h-6 w-20 bg-muted rounded animate-pulse" />
                <div className="h-5 w-16 bg-muted rounded animate-pulse" />
                <div className="h-5 w-16 bg-muted rounded animate-pulse" />
              </div>
            </div>
          ))
        ) : (
          watchlist.map((stock) => {
          const isSelected = selectedStock?.symbol === stock.symbol;
          const isPlaceholder = stock.price === 0 && stock.change === 0 && stock.changePercent === 0;
          const bgColor = getBackgroundColor(stock.changePercent);
          const textColor = getTextColor(stock.changePercent, stock.change);

          if (isPlaceholder) {
            return (
              <div
                key={stock.symbol}
                className="flex flex-col justify-between p-4 border-2 border-muted-foreground/10"
              >
                {/* Ticker - Large - Show actual symbol */}
                <div className="flex items-center justify-between mb-2">
                  <div className="font-bold text-xl sm:text-2xl text-gray-900 dark:text-gray-100">
                    {stock.symbol}
                  </div>
                  {isMobile && (() => {
                    const otherWatchlists = getOtherWatchlists(stock.symbol);
                    if (otherWatchlists.length > 0) {
                      const isOpen = openTooltipSymbol === stock.symbol;
                      return (
                        <Tooltip 
                          open={isOpen} 
                          onOpenChange={(open) => setOpenTooltipSymbol(open ? stock.symbol : null)}
                          delayDuration={0}
                        >
                          <TooltipTrigger asChild>
                            <button 
                              type="button" 
                              className="inline-flex items-center justify-center w-5 h-5 text-purple-500 hover:text-purple-600 active:text-purple-700 cursor-help flex-shrink-0 focus:outline-none touch-manipulation"
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                setOpenTooltipSymbol(isOpen ? null : stock.symbol);
                              }}
                              onMouseDown={(e) => e.stopPropagation()}
                              onTouchStart={(e) => e.stopPropagation()}
                              aria-label={`${otherWatchlists.map(wl => wl.name).join(", ")}`}
                            >
                              <Bookmark className="w-4 h-4 flex-shrink-0 fill-purple-500 text-purple-500" strokeWidth={2} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="text-xs px-2 py-1 z-50 max-w-[200px]">
                            <p className="font-normal">{otherWatchlists.map(wl => wl.name).join(", ")}</p>
                          </TooltipContent>
                        </Tooltip>
                      );
                    }
                    return null;
                  })()}
                </div>
                
                {/* Price, Percent Change, Dollar Change - Skeleton loaders */}
                <div className="space-y-1">
                  <div className="h-6 w-20 bg-muted rounded animate-pulse" />
                  <div className="h-5 w-16 bg-muted rounded animate-pulse" />
                  <div className="h-5 w-16 bg-muted rounded animate-pulse" />
                </div>
              </div>
            );
          }

          return (
            <div
              key={stock.symbol}
              onClick={() => onStockSelect(stock)}
              className={`
                ${bgColor}
                cursor-pointer transition-all
                border-2 ${isSelected ? "border-primary/50" : "border-transparent"} hover:border-primary/50
                ${isSelected ? "[box-shadow:inset_0_0_0_2px_hsl(var(--primary)/0.5)]" : ""}
                hover:[box-shadow:inset_0_0_0_2px_hsl(var(--primary)/0.5)]
                flex flex-col justify-between p-4
              `}
            >
              {/* Ticker - Large with bookmark icon on mobile */}
              <div className="flex items-center justify-between mb-2">
                <div className="font-bold text-xl sm:text-2xl text-gray-900 dark:text-gray-100">
                  {stock.symbol}
                </div>
                {isMobile && (() => {
                  const otherWatchlists = getOtherWatchlists(stock.symbol);
                  if (otherWatchlists.length > 0) {
                    const isOpen = openTooltipSymbol === stock.symbol;
                    return (
                      <Tooltip 
                        open={isOpen} 
                        onOpenChange={(open) => setOpenTooltipSymbol(open ? stock.symbol : null)}
                        delayDuration={0}
                      >
                        <TooltipTrigger asChild>
                          <button 
                            type="button" 
                            className="inline-flex items-center justify-center w-5 h-5 text-purple-500 hover:text-purple-600 active:text-purple-700 cursor-help flex-shrink-0 focus:outline-none touch-manipulation"
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setOpenTooltipSymbol(isOpen ? null : stock.symbol);
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            onTouchStart={(e) => e.stopPropagation()}
                            aria-label={`${otherWatchlists.map(wl => wl.name).join(", ")}`}
                          >
                            <Bookmark className="w-4 h-4 flex-shrink-0 fill-purple-500 text-purple-500" strokeWidth={2} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="text-xs px-2 py-1 z-50 max-w-[200px]">
                          <p className="font-normal">{otherWatchlists.map(wl => wl.name).join(", ")}</p>
                        </TooltipContent>
                      </Tooltip>
                    );
                  }
                  return null;
                })()}
              </div>

              {/* Price, Percent Change, Dollar Change */}
              <div className={`space-y-1 ${textColor}`}>
                {/* Current Price */}
                <div className="text-lg font-semibold">
                  ${stock.price.toFixed(2)}
                </div>

                {/* Percent Change */}
                <div className="text-sm font-medium">
                  {stock.changePercent >= 0 ? "+" : ""}
                  {stock.changePercent.toFixed(2)}%
                </div>

                {/* Dollar Change */}
                <div className="text-sm font-medium">
                  {stock.change >= 0 ? "+$" : "-$"}{Math.abs(stock.change).toFixed(2)}
                </div>
              </div>
            </div>
          );
        })
        )}
      </div>
      </TooltipProvider>
      </div>
    </div>
  );
}

// Temporarily remove memo to debug symbolMetadata prop passing
export const StockHeatmap = StockHeatmapComponent;

