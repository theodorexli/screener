import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { ArrowUp, ArrowDown, HelpCircle } from "lucide-react";
import { type StockTicker } from "@/data/stockTickers";
import { fetchWatchlists } from "@/services/api";

interface BasicSidebarProps {
  onStockSelect: (stock: StockTicker) => void;
  selectedStock: StockTicker | null;
  watchlist: StockTicker[];
  isLoading?: boolean;
  symbolMetadata?: Record<string, { longName?: string; website?: string; allocateAgressive?: number }>;
  tickerDetailsHeight?: number;
  totalSymbolsCount?: number; // Total number of symbols in watchlist from Notion
}

const DEFAULT_SIDEBAR_WIDTHS = {
  symbol: 90,
  last: 70,
  chg: 70,
  chgPercent: 70,
};

export function BasicSidebar({ 
  onStockSelect, 
  selectedStock, 
  watchlist,
  isLoading = false,
  symbolMetadata: _symbolMetadata = {},
  tickerDetailsHeight: _tickerDetailsHeight,
  totalSymbolsCount: _totalSymbolsCount,
}: BasicSidebarProps) {
  const [columnWidths, setColumnWidths] = useState(DEFAULT_SIDEBAR_WIDTHS);
  const [sortColumn, setSortColumn] = useState<'symbol' | 'price' | 'change' | 'changePercent' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const contentContainerRef = useRef<HTMLDivElement>(null);

  // Load default sort from API
  useEffect(() => {
    fetchWatchlists()
      .then((data: any) => {
        if (data.defaultSort) {
          setSortColumn(data.defaultSort.column as 'symbol' | 'price' | 'change' | 'changePercent');
          setSortDirection(data.defaultSort.direction as 'asc' | 'desc');
        }
      })
      .catch((err) => {
        console.error("Failed to load watchlists:", err);
      });
  }, []);

  // Sort watchlist based on current sort column and direction
  const sortedWatchlist = useMemo(() => {
    if (!sortColumn) return watchlist;
    
    return [...watchlist].sort((a, b) => {
      let aValue: number | string;
      let bValue: number | string;
      
      switch (sortColumn) {
        case 'symbol':
          aValue = a.symbol;
          bValue = b.symbol;
          break;
        case 'price':
          aValue = a.price;
          bValue = b.price;
          break;
        case 'change':
          aValue = a.change;
          bValue = b.change;
          break;
        case 'changePercent':
          aValue = a.changePercent;
          bValue = b.changePercent;
          break;
        default:
          return 0;
      }
      
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === 'asc' 
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      } else {
        return sortDirection === 'asc' 
          ? (aValue as number) - (bValue as number)
          : (bValue as number) - (aValue as number);
      }
    });
  }, [watchlist, sortColumn, sortDirection]);

  const handleSort = useCallback((column: 'symbol' | 'price' | 'change' | 'changePercent') => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  }, [sortColumn, sortDirection]);

  const handleMouseDown = useCallback((column: keyof typeof DEFAULT_SIDEBAR_WIDTHS, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const startX = e.clientX;
    const startWidth = columnWidths[column];

    const handleMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - startX;
      const newWidth = Math.max(50, startWidth + diff);
      setColumnWidths(prev => ({ ...prev, [column]: newWidth }));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [columnWidths]);


  return (
    <div className="flex-1 mt-0 overflow-hidden flex flex-col">
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto overflow-x-auto relative">
        {/* Headers */}
        <div className="sticky top-0 bg-background border-b z-10">
          <div className="pl-2 text-xs text-muted-foreground flex items-center gap-2">
            <span 
              className="font-medium relative flex-shrink-0 text-left px-2 py-2 cursor-pointer hover:text-foreground hover:bg-muted/50 select-none flex items-center gap-1 rounded-sm transition-colors" 
              style={{ width: `${columnWidths.symbol}px` }}
              onClick={() => handleSort('symbol')}
            >
              Ticker
              {sortColumn === 'symbol' && (
                sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
              )}
              <div
                className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/50 active:bg-primary z-10"
                onMouseDown={(e) => handleMouseDown("symbol", e)}
                onClick={(e) => e.stopPropagation()}
              />
            </span>
            <span 
              className="font-medium relative flex-shrink-0 text-right px-2 py-2 cursor-pointer hover:text-foreground hover:bg-muted/50 select-none flex items-center gap-1 justify-end rounded-sm transition-colors" 
              style={{ width: `${columnWidths.last}px` }}
              onClick={() => handleSort('price')}
            >
              Last
              {sortColumn === 'price' && (
                sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
              )}
              <div
                className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/50 active:bg-primary z-10"
                onMouseDown={(e) => handleMouseDown("last", e)}
                onClick={(e) => e.stopPropagation()}
              />
            </span>
            <span 
              className="font-medium relative flex-shrink-0 text-right px-2 py-2 cursor-pointer hover:text-foreground hover:bg-muted/50 select-none flex items-center gap-1 justify-end rounded-sm transition-colors" 
              style={{ width: `${columnWidths.chg}px` }}
              onClick={() => handleSort('change')}
            >
              Chg
              {sortColumn === 'change' && (
                sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
              )}
              <div
                className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/50 active:bg-primary z-10"
                onMouseDown={(e) => handleMouseDown("chg", e)}
                onClick={(e) => e.stopPropagation()}
              />
            </span>
            <span 
              className="font-medium flex-shrink-0 text-right px-2 py-2 cursor-pointer hover:text-foreground hover:bg-muted/50 select-none flex items-center gap-1 justify-end rounded-sm transition-colors" 
              style={{ width: `${columnWidths.chgPercent}px` }}
              onClick={() => handleSort('changePercent')}
            >
              Chg%
              {sortColumn === 'changePercent' && (
                sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
              )}
            </span>
          </div>
        </div>

        {/* Stock List */}
        <div ref={contentContainerRef} className="relative">
          {sortedWatchlist.map((stock) => {
            const isPlaceholder = stock.name === stock.symbol && stock.price === 0 && stock.change === 0 && stock.changePercent === 0;
            // Show skeleton if loading OR if values are zero (likely still loading)
            const hasZeroValues = stock.price === 0 && stock.change === 0 && stock.changePercent === 0;
            const showSkeleton = isLoading || (hasZeroValues && !isPlaceholder);
            
            return (
              <div
                key={stock.symbol}
                onClick={() => !showSkeleton && !isPlaceholder && onStockSelect(stock)}
                className={`pl-2 py-1.5 transition-colors text-xs flex items-center gap-2 rounded-sm relative border-b border-gray-200 ${
                  showSkeleton || isPlaceholder
                    ? "opacity-60" 
                    : "cursor-pointer"
                } ${
                  selectedStock?.symbol === stock.symbol
                    ? "bg-muted"
                    : "hover:bg-muted/70"
                }`}
              >
                <div className="flex items-center gap-2 flex-shrink-0 text-left px-2" style={{ width: `${columnWidths.symbol}px` }}>
                  {stock.logoUrl && !showSkeleton && !isPlaceholder ? (
                    <img
                      src={stock.logoUrl}
                      alt={`${stock.symbol} logo`}
                      className="w-5 h-5 rounded-lg object-cover flex-shrink-0"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const placeholder = e.currentTarget.nextElementSibling as HTMLElement;
                        if (placeholder) {
                          placeholder.style.display = 'flex';
                          placeholder.classList.remove('hidden');
                        }
                      }}
                    />
                  ) : null}
                  <div 
                    className={`w-5 h-5 rounded-lg flex items-center justify-center flex-shrink-0 text-gray-400 ${stock.logoUrl && !showSkeleton && !isPlaceholder ? 'hidden' : 'flex'}`}
                    style={{ display: stock.logoUrl && !showSkeleton && !isPlaceholder ? 'none' : 'flex' }}
                  >
                    <HelpCircle className="w-4 h-4" />
                  </div>
                  <span className="font-medium text-xs">{stock.symbol}</span>
                </div>
                {showSkeleton ? (
                  <>
                    <div className="h-4 bg-muted animate-pulse rounded flex-shrink-0 text-right px-2" style={{ width: `${columnWidths.last}px` }}></div>
                    <div className="h-4 bg-muted animate-pulse rounded flex-shrink-0 text-right px-2" style={{ width: `${columnWidths.chg}px` }}></div>
                    <div className="h-4 bg-muted animate-pulse rounded flex-shrink-0 text-right px-2" style={{ width: `${columnWidths.chgPercent}px` }}></div>
                  </>
                ) : isPlaceholder ? (
                  <>
                    <span className="text-xs text-muted-foreground flex-shrink-0 text-right px-2" style={{ width: `${columnWidths.last}px` }}>—</span>
                    <span className="text-xs text-muted-foreground flex-shrink-0 text-right px-2" style={{ width: `${columnWidths.chg}px` }}>—</span>
                    <span className="text-xs text-muted-foreground flex-shrink-0 text-right px-2" style={{ width: `${columnWidths.chgPercent}px` }}>—</span>
                  </>
                ) : (
                  <>
                    <span className="text-xs font-medium tabular-nums flex-shrink-0 text-right px-2" style={{ width: `${columnWidths.last}px` }}>${stock.price.toFixed(2)}</span>
                    <span
                      className={`text-xs tabular-nums flex-shrink-0 text-right px-2 ${
                        stock.change >= 0 ? "text-green-600" : "text-red-600"
                      }`}
                      style={{ width: `${columnWidths.chg}px` }}
                    >
                      {stock.change >= 0 ? "+" : ""}
                      {stock.change.toFixed(2)}
                    </span>
                    <span
                      className={`text-xs tabular-nums flex-shrink-0 text-right px-2 ${
                        stock.changePercent >= 0 ? "text-green-600" : "text-red-600"
                      }`}
                      style={{ width: `${columnWidths.chgPercent}px` }}
                    >
                      {stock.changePercent >= 0 ? "+" : ""}
                      {stock.changePercent.toFixed(2)}%
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

