import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Table2, LayoutGrid, Sparkles, MoreVertical, Clock, RefreshCw, Infinity, Power, TrendingUp } from "lucide-react";
import { StockChart } from "@/components/StockChart";
import { StockTable } from "@/components/StockTable";
import { WatchlistSidebar } from "@/components/WatchlistSidebar";
import { WelcomeModal } from "@/components/WelcomeModal";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type StockTicker } from "@/data/stockTickers";
import { fetchWatchlists, fetchStockData } from "@/services/api";
import { StockHeatmap } from "@/components/StockHeatmap";
import { ChatSidebar } from "@/components/ChatSidebar";

const DEFAULT_SPY_SYMBOL = "SPY";
const DEFAULT_SPY_LONG_NAME = "SPDR S&P 500 ETF Trust";
const DEFAULT_SPY_WEBSITE = "https://www.ssga.com/us/en/intermediary/etfs/spdr-sp-500-etf-trust-spy";

interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
}

// Calculate minSize as percentage based on min width
function calculateMinSize(minWidth: number): number {
  if (typeof window !== 'undefined') {
    const containerWidth = window.innerWidth;
    if (containerWidth > 0) {
      const minSizePercent = (minWidth / containerWidth) * 100;
      return Math.min(Math.max(minSizePercent, 5), 50); // Clamp between 5% and 50%
    }
  }
  return 20; // Fallback
}

function App() {
  const [selectedStock, setSelectedStock] = useState<StockTicker | null>(null);
  const [activeWatchlist, setActiveWatchlist] = useState<string>("");
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [watchlistStocks, setWatchlistStocks] = useState<Record<string, StockTicker[]>>({});
  const [watchlistSymbols, setWatchlistSymbols] = useState<Record<string, string[]>>({});
  const [symbolMetadata, setSymbolMetadata] = useState<Record<string, { longName?: string; website?: string; allocateAgressive?: number }>>({});
  const [dataLoaded, setDataLoaded] = useState<boolean>(false);
  const [isLoadingFresh, setIsLoadingFresh] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const hasLoadedDefaultSpy = useRef<boolean>(false);
  const urlRestoredRef = useRef<boolean>(false);
  const tickerDetailsRef = useRef<HTMLDivElement>(null);
  const hadWatchlistInUrlRef = useRef<boolean>(
    typeof window !== 'undefined' 
      ? new URLSearchParams(window.location.search).get('watchlist') !== null
      : false
  );
  const [tickerDetailsHeight, setTickerDetailsHeight] = useState<number>(0);
  const [showDisclaimer, setShowDisclaimer] = useState<boolean>(() => {
    return localStorage.getItem('disclaimer-dismissed') !== 'true';
  });
  const [versionCopied, setVersionCopied] = useState<boolean>(false);
  // Pull-to-refresh state for mobile
  const [pullToRefreshDistance, setPullToRefreshDistance] = useState<number>(0);
  const [isPulling, setIsPulling] = useState<boolean>(false);
  const [pullStartY, setPullStartY] = useState<number | null>(null);
  const scrollableContentRef = useRef<HTMLDivElement>(null);
  // Default: 1px border + 16px padding + 300px columns (90+70+70+70) + 24px gaps (8*3) = 341px
  const [sidebarMinWidth, setSidebarMinWidth] = useState<number>(341);
  const [sidebarMinSize, setSidebarMinSize] = useState<number>(() => calculateMinSize(341));
  // Default to 25% which is the minimum needed for 3 columns in heatmap (25-40% range)
  // But ensure it's at least as large as minSize
  const DEFAULT_SIDEBAR_SIZE = 25;
  const [sidebarSize, setSidebarSize] = useState<number>(DEFAULT_SIDEBAR_SIZE);
  
  // Calculate actual default size ensuring it's >= minSize but <= maxSize (40)
  const sidebarDefaultSize = Math.min(Math.max(DEFAULT_SIDEBAR_SIZE, sidebarMinSize), 40);
  const [isChartCollapsed, setIsChartCollapsed] = useState<boolean>(() => {
    const saved = localStorage.getItem('show-chart');
    // If show-chart is 'true', then chart is NOT collapsed
    // Default based on screen size: hide on mobile, show on desktop
    if (saved === null) {
      // Check if mobile (screen width < 1024px which is lg breakpoint)
      if (typeof window !== 'undefined') {
        return window.innerWidth < 1024; // Hide chart by default on mobile
      }
      return false; // Fallback: show chart by default
    }
    return saved !== 'true';
  });
  const [viewMode, setViewMode] = useState<"table" | "heatmap" | "chat">(() => {
    const saved = localStorage.getItem('sidebar-view-mode');
    // Default to 'heatmap' on first load (when saved is null)
    if (!saved) {
      return 'heatmap';
    }
    if (saved === 'basic') {
      return 'table';
    }
    if (saved === 'heatmap' || saved === 'chat') {
      return saved;
    }
    // Fallback to 'heatmap' if invalid value
    return 'heatmap';
  });
  const [mainViewMode, setMainViewMode] = useState<"table" | "heatmap" | "chat">(() => {
    const saved = localStorage.getItem('main-view-mode');
    const savedValue = saved as "table" | "heatmap" | "chat";
    // If saved value is "chart", default to "table" instead
    if (saved === 'chart') {
      return 'table';
    }
    return savedValue || 'table';
  });
  
  const dismissDisclaimer = () => {
    localStorage.setItem('disclaimer-dismissed', 'true');
    setShowDisclaimer(false);
  };

  // Get version string
  const getVersionString = (): string => {
    try {
      // @ts-ignore - Build-time constants
      const buildId = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'unknown';
      const buildEpoch = typeof __BUILD_EPOCH__ !== 'undefined' ? __BUILD_EPOCH__ : null;
      if (buildEpoch) {
        return `Version ${buildId}-${buildEpoch}`;
      }
      return `Version ${buildId}`;
    } catch (e) {
      return 'Version unknown';
    }
  };

  // Copy version to clipboard
  const handleCopyVersion = async () => {
    const versionString = getVersionString();
    try {
      await navigator.clipboard.writeText(versionString);
      setVersionCopied(true);
      setTimeout(() => setVersionCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy version:', err);
    }
  };

  // Custom setSelectedStock that also updates URL
  const handleStockSelect = useCallback((stock: StockTicker | null) => {
    setSelectedStock(stock);
    
    // Update URL with selected stock and watchlist
    const url = new URL(window.location.href);
    if (stock) {
      url.searchParams.set('ticker', stock.symbol);
    } else {
      url.searchParams.delete('ticker');
    }
    // Only add watchlist to URL if it was originally in the URL or explicitly set by user
    // This prevents automatically adding watchlist when going to base page
    if (activeWatchlist && hadWatchlistInUrlRef.current) {
      url.searchParams.set('watchlist', activeWatchlist);
    } else if (!activeWatchlist) {
      url.searchParams.delete('watchlist');
    }
    window.history.pushState({}, '', url.toString());
  }, [activeWatchlist]);

  // Custom setActiveWatchlist that also updates URL
  const handleWatchlistChange = (watchlistId: string) => {
    setActiveWatchlist(watchlistId);
    
    // When user explicitly changes watchlist, mark it as being in URL and update URL
    hadWatchlistInUrlRef.current = true;
    const url = new URL(window.location.href);
    url.searchParams.set('watchlist', watchlistId);
    window.history.pushState({}, '', url.toString());
  };

  // Load watchlists and stock data from API with caching
  const loadData = useCallback(async (forceRefresh = false) => {
    const CACHE_KEY = 'stock-data-cache';
    const CACHE_TIMESTAMP_KEY = 'stock-data-timestamp';
    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
    
    try {
      // Fetch watchlists configuration
      const data = await fetchWatchlists();
      setWatchlists(data.watchlists);
      
      // Store symbol metadata (long names from Notion)
      if (data.symbolMetadata) {
        setSymbolMetadata(data.symbolMetadata);
      }
      
      // Store symbols immediately so we can show them before stock data loads
      const symbolsMap: Record<string, string[]> = {};
      data.watchlists.forEach(watchlist => {
        symbolsMap[watchlist.id] = watchlist.symbols;
      });
      setWatchlistSymbols(symbolsMap);
      
      // Don't set watchlist here if URL has one - let URL restoration handle it
      // Only set default if URL doesn't have a watchlist AND we haven't restored from URL yet
      const urlParams = new URLSearchParams(window.location.search);
      const watchlistFromUrl = urlParams.get('watchlist');
      if (!watchlistFromUrl && !urlRestoredRef.current) {
        // Use default favorites if available
        if (data.defaultFavorites && data.defaultFavorites.length > 0) {
          const defaultWatchlistId = data.defaultFavorites[0];
          const defaultWatchlistExists = data.watchlists.some(wl => wl.id === defaultWatchlistId);
          if (defaultWatchlistExists) {
            setActiveWatchlist(defaultWatchlistId);
          } else if (data.watchlists.length > 0) {
            // Fallback to first watchlist if default favorite doesn't exist
            setActiveWatchlist(data.watchlists[0].id);
          }
        } else if (data.watchlists.length > 0) {
          // No default favorites, use first watchlist
          setActiveWatchlist(data.watchlists[0].id);
        }
      }
      
      // Collect ALL unique symbols across ALL watchlists
      const allSymbolsSet = new Set<string>();
      data.watchlists.forEach(watchlist => {
        watchlist.symbols.forEach(symbol => allSymbolsSet.add(symbol));
      });
      const allSymbols = Array.from(allSymbolsSet);
      
      // Check if we have cached data and show it immediately (skip if force refresh)
      const cachedData = forceRefresh ? null : localStorage.getItem(CACHE_KEY);
      const cacheTimestamp = forceRefresh ? null : localStorage.getItem(CACHE_TIMESTAMP_KEY);
      const now = Date.now();
      let hasValidCache = false;
      
      if (cachedData && cacheTimestamp && !forceRefresh) {
        const age = now - parseInt(cacheTimestamp);
        if (age < CACHE_DURATION) {
          // Use cached data immediately
          try {
            const cachedStocksMap = JSON.parse(cachedData) as Record<string, StockTicker[]>;
            
            // Merge cached stocks with current watchlist symbols
            // This ensures we show cached data even if watchlist structure changed
            const mergedStocksMap: Record<string, StockTicker[]> = {};
            const baseUrl = import.meta.env.VITE_WORKER_URL || '';
            
            data.watchlists.forEach(watchlist => {
              // Get cached stocks for this watchlist (if it exists in cache)
              const cachedStocks = cachedStocksMap[watchlist.id] || [];
              const cachedStockMap = new Map<string, StockTicker>();
              cachedStocks.forEach(stock => {
                // Add logo URL from website if available and logoUrl is not set
                if (!stock.logoUrl && data.symbolMetadata?.[stock.symbol]?.website) {
                  stock = {
                    ...stock,
                    logoUrl: `${baseUrl}/api/logos/${encodeURIComponent(stock.symbol)}`
                  };
                }
                cachedStockMap.set(stock.symbol, stock);
              });
              
              // For each symbol in the current watchlist, use cached stock if available
              mergedStocksMap[watchlist.id] = watchlist.symbols.map(symbol => {
                const stock = cachedStockMap.get(symbol);
                // If no cached stock, create placeholder with logo if website available
                if (!stock && data.symbolMetadata?.[symbol]?.website) {
                  return {
                    symbol,
                    name: data.symbolMetadata[symbol].longName || symbol,
                    price: 0,
                    change: 0,
                    changePercent: 0,
                    volume: 0,
                    marketCap: 0,
                    logoUrl: `${baseUrl}/api/logos/${encodeURIComponent(symbol)}`
                  } as StockTicker;
                }
                return stock;
              }).filter((stock): stock is StockTicker => stock !== undefined);
            });
            
            setWatchlistStocks(mergedStocksMap);
            setDataLoaded(true);
            hasValidCache = true;
          } catch (err) {
            console.error('Failed to parse cached data:', err);
          }
        }
      }
      
      // If no valid cache, show loading state
      if (!hasValidCache) {
        setDataLoaded(false);
      }
      
      // Always fetch fresh data in the background (even if cache is valid)
      setIsLoadingFresh(true);
      
      // Fetch stock data in batches to avoid worker timeout
      // Batch size of 5 symbols per request for better reliability
      const batchSize = 5;
      const batches: string[][] = [];
      for (let i = 0; i < allSymbols.length; i += batchSize) {
        batches.push(allSymbols.slice(i, i + batchSize));
      }
      
      // Create a map to track all stocks as they come in
      const stockMap = new Map<string, StockTicker>();
      
      // If we have cached data, populate the map with it first
      if (hasValidCache && cachedData) {
        try {
          const cachedStocksMap = JSON.parse(cachedData) as Record<string, StockTicker[]>;
          Object.values(cachedStocksMap).flat().forEach((stock: StockTicker) => {
            stockMap.set(stock.symbol, stock);
          });
        } catch (err) {
          console.error('Failed to parse cached data for progressive update:', err);
        }
      }
      
      // Fetch batches and update progressively
      for (let i = 0; i < batches.length; i++) {
        const batchStocks = await fetchStockData(batches[i]);
        
        // Update the map with fresh data
        batchStocks.forEach(stock => {
          stockMap.set(stock.symbol, stock);
        });
        
        // Update UI progressively with merged data
        const stocksMap: Record<string, StockTicker[]> = {};
        const baseUrl = import.meta.env.VITE_WORKER_URL || '';
        
        data.watchlists.forEach(watchlist => {
          stocksMap[watchlist.id] = watchlist.symbols
            .map(symbol => {
              const stock = stockMap.get(symbol);
              if (!stock) return undefined;
              // Add logo URL from website if available and logoUrl is not set
              if (!stock.logoUrl && data.symbolMetadata?.[symbol]?.website) {
                return {
                  ...stock,
                  logoUrl: `${baseUrl}/api/logos/${encodeURIComponent(symbol)}`
                };
              }
              return stock;
            })
            .filter((stock): stock is StockTicker => stock !== undefined);
        });
        
        setWatchlistStocks(stocksMap);
        setDataLoaded(true);
        
        // Add delay between batches to avoid rate limiting (except after last batch)
        if (i < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      // Final update with all stocks
      const finalStocksMap: Record<string, StockTicker[]> = {};
      const baseUrl = import.meta.env.VITE_WORKER_URL || '';
      
      data.watchlists.forEach(watchlist => {
        finalStocksMap[watchlist.id] = watchlist.symbols
          .map(symbol => {
            const stock = stockMap.get(symbol);
            if (!stock) return undefined;
            // Add logo URL from website if available and logoUrl is not set
            if (!stock.logoUrl && data.symbolMetadata?.[symbol]?.website) {
              return {
                ...stock,
                logoUrl: `${baseUrl}/api/logos/${encodeURIComponent(symbol)}`
              };
            }
            return stock;
          })
          .filter((stock): stock is StockTicker => stock !== undefined);
      });
      
      setIsLoadingFresh(false);
      
      // Save to cache
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(finalStocksMap));
        localStorage.setItem(CACHE_TIMESTAMP_KEY, now.toString());
      } catch (err) {
        console.error('Failed to cache data:', err);
      }
      
      setWatchlistStocks(finalStocksMap);
      setDataLoaded(true);
      setLastUpdated(new Date());
    } catch (err) {
      console.error("❌ Failed to load data from API:", err);
      setIsLoadingFresh(false);
      
      // Try to use cached data even if it's stale
      const cachedData = localStorage.getItem(CACHE_KEY);
      if (cachedData) {
        try {
          const cachedStocksMap = JSON.parse(cachedData);
          setWatchlistStocks(cachedStocksMap);
          setDataLoaded(true);
          console.log('⚠️  Data may be stale due to API error');
        } catch (cacheErr) {
          console.error('Failed to parse cached data:', cacheErr);
          setDataLoaded(true); // Still set to true so UI doesn't hang
        }
      } else {
        setDataLoaded(true); // Set to true even if no cache to prevent infinite loading
      }
    }
  }, []);

  // Load data on mount
  useEffect(() => {
    loadData(false);
  }, [loadData]);

  // Restore watchlist and selected stock from URL on initial load
  useEffect(() => {
    if (!dataLoaded) return;
    // Only restore from URL once
    if (urlRestoredRef.current) return;
    
    const urlParams = new URLSearchParams(window.location.search);
    const watchlistFromUrl = urlParams.get('watchlist');
    const tickerFromUrl = urlParams.get('ticker');
    
    // Restore watchlist if specified in URL (this takes precedence over defaults)
    // Check if watchlist exists in the watchlists array (not just watchlistStocks, which might not be loaded yet)
    if (watchlistFromUrl) {
      const watchlistExists = watchlists.some(wl => wl.id === watchlistFromUrl);
      if (watchlistExists) {
        setActiveWatchlist(watchlistFromUrl);
        urlRestoredRef.current = true; // Mark as restored so defaults don't override
      }
    } else {
      // No watchlist in URL - mark as restored so we don't set defaults again
      urlRestoredRef.current = true;
    }
    
    // Restore selected stock if specified in URL
    if (tickerFromUrl) {
      // Search for the stock across all watchlists
      let foundStock: StockTicker | null = null;
      let foundWatchlistId: string | null = null;
      
      for (const watchlistId in watchlistStocks) {
        const stock = watchlistStocks[watchlistId].find(s => s.symbol === tickerFromUrl);
        if (stock) {
          foundStock = stock;
          foundWatchlistId = watchlistId;
          break;
        }
      }
      
      if (foundStock) {
        setSelectedStock(foundStock);
        // If watchlist wasn't specified in URL, switch to the one containing this stock
        if (!watchlistFromUrl && foundWatchlistId) {
          setActiveWatchlist(foundWatchlistId);
        }
      } else {
        // Stock not found in watchlists - fetch it from API
        fetchStockData([tickerFromUrl])
          .then((stocks) => {
            if (stocks.length > 0) {
              const stock = stocks[0];
              const baseUrl = import.meta.env.VITE_WORKER_URL || '';
              
              // Special handling for SPY default metadata
              if (tickerFromUrl === DEFAULT_SPY_SYMBOL) {
                setSymbolMetadata((prev) => ({
                  ...prev,
                  [DEFAULT_SPY_SYMBOL]: {
                    longName: DEFAULT_SPY_LONG_NAME,
                    website: DEFAULT_SPY_WEBSITE,
                  },
                }));
              }
              
              // Get metadata for this symbol if available
              const metadata = symbolMetadata[tickerFromUrl] || 
                (tickerFromUrl === DEFAULT_SPY_SYMBOL 
                  ? { longName: DEFAULT_SPY_LONG_NAME, website: DEFAULT_SPY_WEBSITE }
                  : undefined);
              const longName = metadata?.longName || stock.name || tickerFromUrl;
              const website = metadata?.website;
              
              // Add logo URL if website is available
              let logoUrl = stock.logoUrl;
              if (!logoUrl && website) {
                logoUrl = `${baseUrl}/api/logos/${encodeURIComponent(tickerFromUrl)}`;
              }
              
              const stockWithMetadata: StockTicker = {
                ...stock,
                name: longName,
                logoUrl: logoUrl,
              };
              
              handleStockSelect(stockWithMetadata);
            }
          })
          .catch((err) => {
            console.error(`Failed to load stock ${tickerFromUrl} from URL:`, err);
          });
      }
    }
    
    urlRestoredRef.current = true;
  }, [dataLoaded, watchlistStocks, symbolMetadata, handleStockSelect]);

  // Load SPY as default stock if nothing is selected (runs after URL restoration)
  useEffect(() => {
    // Wait for data to be loaded and URL restoration to complete
    if (!dataLoaded || !urlRestoredRef.current) return;
    
    const urlParams = new URLSearchParams(window.location.search);
    const tickerFromUrl = urlParams.get('ticker');
    
    // Check if SPY is selected but missing data (e.g., no priceHistory, price is 0, etc.)
    const isSpySelectedButIncomplete = selectedStock?.symbol === DEFAULT_SPY_SYMBOL && (
      !selectedStock.priceHistory || 
      selectedStock.priceHistory.length === 0 || 
      selectedStock.price === 0
    );
    
    // If SPY is selected but incomplete, fetch data immediately (similar to chat -> reset)
    if (isSpySelectedButIncomplete) {
      // Use a ref to prevent multiple simultaneous fetches
      if (hasLoadedDefaultSpy.current) {
        // Already fetching, wait for it to complete
        return;
      }
      
      hasLoadedDefaultSpy.current = true;
      
      // Fetch SPY data from API
      fetchStockData([DEFAULT_SPY_SYMBOL])
        .then((stocks) => {
          if (stocks.length > 0) {
            const baseUrl = import.meta.env.VITE_WORKER_URL || '';
            const logoUrl = stocks[0].logoUrl || `${baseUrl}/api/logos/${encodeURIComponent(DEFAULT_SPY_SYMBOL)}`;
            const spyStock = {
              ...stocks[0],
              name: stocks[0].name || DEFAULT_SPY_LONG_NAME,
              logoUrl: logoUrl,
            };

            setSymbolMetadata((prev) => ({
              ...prev,
              [DEFAULT_SPY_SYMBOL]: {
                longName: DEFAULT_SPY_LONG_NAME,
                website: DEFAULT_SPY_WEBSITE,
              },
            }));

            handleStockSelect(spyStock);
            // Keep hasLoadedDefaultSpy.current = true to prevent re-fetching
          } else {
            // If fetch failed, allow retry
            hasLoadedDefaultSpy.current = false;
          }
        })
        .catch((err) => {
          console.error('Failed to load SPY stock data:', err);
          hasLoadedDefaultSpy.current = false; // Allow retry on error
        });
      return;
    }
    
    // Don't load if already selected (and complete) or already attempted
    if (selectedStock || hasLoadedDefaultSpy.current) return;
    
    // Only load SPY if there's no ticker in URL
    if (!tickerFromUrl) {
      hasLoadedDefaultSpy.current = true;
      
      // First, check if SPY is already in cached watchlist stocks
      const CACHE_KEY = 'stock-data-cache';
      const CACHE_TIMESTAMP_KEY = 'stock-data-timestamp';
      const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
      
      const cachedData = localStorage.getItem(CACHE_KEY);
      const cacheTimestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
      const now = Date.now();
      
      let cachedSpyStock: StockTicker | null = null;
      
      // Check cache if it's still valid
      if (cachedData && cacheTimestamp) {
        const age = now - parseInt(cacheTimestamp);
        if (age < CACHE_DURATION) {
          try {
            const cachedStocksMap = JSON.parse(cachedData) as Record<string, StockTicker[]>;
            // Search through all watchlists for SPY
            for (const watchlistId in cachedStocksMap) {
              const stocks = cachedStocksMap[watchlistId];
              const spyStock = stocks.find(s => s.symbol === DEFAULT_SPY_SYMBOL);
              if (spyStock) {
                cachedSpyStock = spyStock;
                break;
              }
            }
          } catch (err) {
            console.error('Failed to parse cached data for SPY:', err);
          }
        }
      }
      
      // Also check if SPY is in current watchlist stocks state
      if (!cachedSpyStock) {
        for (const watchlistId in watchlistStocks) {
          const stocks = watchlistStocks[watchlistId];
          const spyStock = stocks.find(s => s.symbol === DEFAULT_SPY_SYMBOL);
          if (spyStock) {
            cachedSpyStock = spyStock;
            break;
          }
        }
      }
      
      // If we found SPY in cache, use it immediately
      if (cachedSpyStock) {
        const baseUrl = import.meta.env.VITE_WORKER_URL || '';
        const logoUrl = cachedSpyStock.logoUrl || `${baseUrl}/api/logos/${encodeURIComponent(DEFAULT_SPY_SYMBOL)}`;
        const spyStock = {
          ...cachedSpyStock,
          name: cachedSpyStock.name || DEFAULT_SPY_LONG_NAME,
          logoUrl: logoUrl,
        };

        setSymbolMetadata((prev) => ({
          ...prev,
          [DEFAULT_SPY_SYMBOL]: {
            longName: DEFAULT_SPY_LONG_NAME,
            website: DEFAULT_SPY_WEBSITE,
          },
        }));

        handleStockSelect(spyStock);
        
        // Still fetch fresh data in background to update cache
        fetchStockData([DEFAULT_SPY_SYMBOL])
          .then((stocks) => {
            if (stocks.length > 0) {
              // Update the selected stock with fresh data
              const freshSpyStock = {
                ...stocks[0],
                name: stocks[0].name || DEFAULT_SPY_LONG_NAME,
                logoUrl: stocks[0].logoUrl || logoUrl,
              };
              handleStockSelect(freshSpyStock);
            }
          })
          .catch((err) => {
            console.error('Failed to refresh SPY stock data:', err);
          });
      } else {
        // No cache, fetch fresh data
        fetchStockData([DEFAULT_SPY_SYMBOL])
          .then((stocks) => {
            if (stocks.length > 0) {
              const baseUrl = import.meta.env.VITE_WORKER_URL || '';
              const logoUrl = `${baseUrl}/api/logos/${encodeURIComponent(DEFAULT_SPY_SYMBOL)}`;
              const spyStock = {
                ...stocks[0],
                name: stocks[0].name || DEFAULT_SPY_LONG_NAME,
                logoUrl: stocks[0].logoUrl || logoUrl,
              };

              setSymbolMetadata((prev) => ({
                ...prev,
                [DEFAULT_SPY_SYMBOL]: {
                  longName: DEFAULT_SPY_LONG_NAME,
                  website: DEFAULT_SPY_WEBSITE,
                },
              }));

              handleStockSelect(spyStock);
            } else {
              // If fetch failed, allow retry
              hasLoadedDefaultSpy.current = false;
            }
          })
          .catch((err) => {
            console.error('Failed to load default SPY stock:', err);
            hasLoadedDefaultSpy.current = false; // Allow retry on error
          });
      }
    }
  }, [dataLoaded, selectedStock, handleStockSelect, watchlistStocks]);

  // Memoize currentWatchlist - merge symbols with stock data so we show all symbols immediately
  // Use a ref to preserve stock data and prevent flickering
  const previousStocksRef = useRef<Map<string, StockTicker>>(new Map());
  
  const currentWatchlist = useMemo(() => {
    const symbols = watchlistSymbols[activeWatchlist] || [];
    const stocks = watchlistStocks[activeWatchlist] || [];
    
    // Create a map of stocks by symbol for quick lookup
    const stockMap = new Map<string, StockTicker>();
    stocks.forEach(stock => {
      // Update stock name with long name from Notion if available
      const metadata = symbolMetadata[stock.symbol];
      if (metadata?.longName) {
        stock = { ...stock, name: metadata.longName };
      }
      // Add logo URL from website if available and logoUrl is not set
      if (!stock.logoUrl && metadata?.website) {
        const baseUrl = import.meta.env.VITE_WORKER_URL || '';
        stock = { 
          ...stock, 
          logoUrl: `${baseUrl}/api/logos/${encodeURIComponent(stock.symbol)}`
        };
      }
      stockMap.set(stock.symbol, stock);
      // Also update the ref to preserve this stock
      previousStocksRef.current.set(stock.symbol, stock);
    });
    
    // Return all symbols, with stock data if available, or placeholder if not
    return symbols.map(symbol => {
      // First check current stockMap
      const stock = stockMap.get(symbol);
      if (stock && stock.price > 0) {
        return stock;
      }
      
      // If no current stock but we have a previous one with data, use that to prevent flickering
      const previousStock = previousStocksRef.current.get(symbol);
      if (previousStock && previousStock.price > 0) {
        return previousStock;
      }
      
      // Return placeholder stock with long name from Notion if available
      const metadata = symbolMetadata[symbol];
      const placeholder: StockTicker = {
        symbol,
        name: metadata?.longName || symbol,
        price: 0,
        change: 0,
        changePercent: 0,
        volume: 0,
        marketCap: 0,
      };
      // Add logo URL if website is available
      if (metadata?.website) {
        const baseUrl = import.meta.env.VITE_WORKER_URL || '';
        placeholder.logoUrl = `${baseUrl}/api/logos/${encodeURIComponent(symbol)}`;
      }
      return placeholder;
    });
  }, [watchlistStocks, watchlistSymbols, activeWatchlist, symbolMetadata]);

  // Calculate minSize as percentage based on actual min width
  useEffect(() => {
    const updateMinSize = () => {
      const newMinSize = calculateMinSize(sidebarMinWidth);
      setSidebarMinSize(newMinSize);
    };

    updateMinSize();
    window.addEventListener('resize', updateMinSize);
    return () => window.removeEventListener('resize', updateMinSize);
  }, [sidebarMinWidth]);

  // Persist sidebar view mode to localStorage
  useEffect(() => {
    // Map "table" to "basic" for user-friendly storage
    const storageValue = viewMode === 'table' ? 'basic' : viewMode;
    localStorage.setItem('sidebar-view-mode', storageValue);
  }, [viewMode]);

  // Persist chart visibility preference to localStorage
  useEffect(() => {
    // Store the inverse: show-chart = !isChartCollapsed
    localStorage.setItem('show-chart', (!isChartCollapsed).toString());
  }, [isChartCollapsed]);

  // Persist main view mode to localStorage
  useEffect(() => {
    localStorage.setItem('main-view-mode', mainViewMode);
  }, [mainViewMode]);

  // Pull-to-refresh handlers for mobile using native event listeners (non-passive)
  useEffect(() => {
    const scrollContainer = scrollableContentRef.current;
    if (!scrollContainer) return;

    const handleTouchStart = (e: TouchEvent) => {
      // Only trigger if we're at the top of the scroll
      if (scrollContainer.scrollTop === 0) {
        setPullStartY(e.touches[0].clientY);
        setIsPulling(true);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (pullStartY === null || !isPulling) return;
      
      const currentY = e.touches[0].clientY;
      const distance = currentY - pullStartY;
      
      // Only allow pull down (positive distance) and only if at top
      if (distance > 0 && scrollContainer.scrollTop === 0) {
        // Prevent default scrolling while pulling
        e.preventDefault();
        
        // Cap the pull distance for better UX (max 100px)
        const cappedDistance = Math.min(distance * 0.6, 100); // Add resistance
        setPullToRefreshDistance(cappedDistance);
      } else if (distance <= 0 || scrollContainer.scrollTop > 0) {
        // Reset if user scrolls up or container is scrolled
        setPullToRefreshDistance(0);
        setIsPulling(false);
        setPullStartY(null);
      }
    };

    const handleTouchCancel = () => {
      // Handle touch cancel (e.g., when user switches apps or touch is interrupted)
      setPullToRefreshDistance(0);
      setIsPulling(false);
      setPullStartY(null);
    };

    const handleTouchEnd = () => {
      // Only trigger refresh if pulled enough and not already loading
      if (pullToRefreshDistance >= 50 && !isLoadingFresh) {
        // Clear portfolio growth calculator cache
        try {
          const keys = Object.keys(localStorage);
          keys.forEach(key => {
            if (key.startsWith('historical-prices-')) {
              localStorage.removeItem(key);
            }
          });
        } catch (e) {
          // Ignore errors
        }
        loadData(true);
      }
      
      // Always reset pull state with animation when user releases
      // This collapses the indicator even if loading
      setPullToRefreshDistance(0);
      setIsPulling(false);
      setPullStartY(null);
    };

    // Add event listeners with { passive: false } to allow preventDefault
    scrollContainer.addEventListener('touchstart', handleTouchStart, { passive: true });
    scrollContainer.addEventListener('touchmove', handleTouchMove, { passive: false });
    scrollContainer.addEventListener('touchend', handleTouchEnd, { passive: true });
    scrollContainer.addEventListener('touchcancel', handleTouchCancel, { passive: true });

    return () => {
      scrollContainer.removeEventListener('touchstart', handleTouchStart);
      scrollContainer.removeEventListener('touchmove', handleTouchMove);
      scrollContainer.removeEventListener('touchend', handleTouchEnd);
      scrollContainer.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [pullStartY, isPulling, isLoadingFresh, pullToRefreshDistance, loadData]);


  // Measure ticker details height for table header positioning
  useEffect(() => {
    const updateHeight = () => {
      if (tickerDetailsRef.current) {
        setTickerDetailsHeight(tickerDetailsRef.current.offsetHeight);
      }
    };
    
    updateHeight();
    const resizeObserver = new ResizeObserver(updateHeight);
    if (tickerDetailsRef.current) {
      resizeObserver.observe(tickerDetailsRef.current);
    }
    
    return () => resizeObserver.disconnect();
  }, [selectedStock, isChartCollapsed]);

  // Ensure main panel default size accounts for sidebar minSize
  // Also ensure it's at least 50 (the minSize of the main panel)
  const mainPanelDefaultSize = Math.max(50, 100 - sidebarDefaultSize);


  return (
    <div className="h-screen overflow-hidden bg-background">
      <WelcomeModal 
        open={showDisclaimer} 
        onOpenChange={(open) => {
          if (!open) {
            dismissDisclaimer();
          } else {
            setShowDisclaimer(true);
          }
        }} 
      />

      {/* Desktop: Use ResizablePanelGroup */}
      <div className="hidden lg:block h-full">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {/* Main Content Area */}
          <ResizablePanel defaultSize={mainPanelDefaultSize} minSize={50}>
            <div className="flex-1 flex flex-col overflow-hidden h-full">
            {/* Fixed Header - Watchlist Details */}
            <div className="flex-shrink-0 border-b bg-background sticky top-0 z-30 min-h-[64px]">
              <div className="px-4 py-3 flex items-center h-full">
                <div className="flex flex-col gap-3 w-full min-[1251px]:flex-row min-[1251px]:items-center min-[1251px]:justify-between">
                  <div className="flex items-center gap-3 w-full min-w-0">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="transition-all rounded p-1 hover:bg-accent hover:opacity-80 flex-shrink-0 focus:outline-none focus:ring-0"
                          aria-label="Screener menu"
                          title="Screener menu"
                        >
                          <img 
                            src="/Screener.svg" 
                            alt="Screener logo" 
                            className="h-6 w-6"
                          />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-56" align="start">
                        <DropdownMenuItem onSelect={() => setShowDisclaimer(true)}>
                          <Power className="mr-2 h-4 w-4" />
                          Welcome to Screener
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <a href="/predictions" className="cursor-pointer">
                            <TrendingUp className="mr-2 h-4 w-4" />
                            Predictions
                          </a>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                          <a href="https://www.txl.app/projects" target="_blank" rel="noopener noreferrer" className="cursor-pointer flex items-center font-semibold">
                            <span className="mr-2 inline-block">
                              <Infinity className="h-4 w-4" style={{ 
                                stroke: 'url(#txl-gradient)',
                                fill: 'none'
                              }} />
                              <svg className="absolute w-0 h-0">
                                <defs>
                                  <linearGradient id="txl-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%" stopColor="#a855f7" />
                                    <stop offset="50%" stopColor="#ec4899" />
                                    <stop offset="100%" stopColor="#f97316" />
                                  </linearGradient>
                                </defs>
                              </svg>
                            </span>
                            <span className="text-xs bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 bg-clip-text text-transparent">
                              Maintained by TXL
                            </span>
                          </a>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-xs text-muted-foreground cursor-pointer"
                          onSelect={handleCopyVersion}
                        >
                          <span>
                            {versionCopied ? 'Copied!' : getVersionString()}
                          </span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {/* Desktop: Show label and button group */}
                    <span className="hidden min-[1251px]:inline text-sm font-medium text-muted-foreground flex-shrink-0">Watchlists:</span>
                      <ButtonGroup className="hidden min-[1251px]:flex min-w-max">
                        {watchlists.map((wl) => (
                          <Button
                            key={wl.id}
                            variant="outline"
                            size="default"
                            className={`h-9 text-xs px-3 transition-all ${
                              activeWatchlist === wl.id 
                                ? "bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 text-white border-transparent hover:bg-gradient-to-br hover:from-purple-500 hover:via-pink-500 hover:to-orange-500 hover:text-white hover:opacity-90" 
                                : ""
                            }`}
                            onClick={() => handleWatchlistChange(wl.id)}
                          >
                            {wl.name} ({wl.symbols.length})
                          </Button>
                        ))}
                      </ButtonGroup>
                    {/* Mobile: Show dropdown with updating button */}
                    <div className="flex min-[1251px]:hidden flex-1 min-w-0 items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <Select value={activeWatchlist} onValueChange={handleWatchlistChange}>
                          <SelectTrigger className="h-9 text-sm w-full">
                            <SelectValue placeholder="Select watchlist">
                              {watchlists.find(wl => wl.id === activeWatchlist)?.name || "Select watchlist"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {watchlists.map((wl) => {
                              return (
                                <SelectItem key={wl.id} value={wl.id} className="text-sm">
                                  {wl.name} ({wl.symbols.length})
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-7 gap-2 px-2 flex-shrink-0">
                            {isLoadingFresh ? (
                              <span className="text-xs animate-pulse bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 bg-clip-text text-transparent">
                                Updating...
                              </span>
                            ) : lastUpdated ? (
                              <span className="text-xs text-muted-foreground">
                                Updated {lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">Updated</span>
                            )}
                            <MoreVertical className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-40" align="end">
                          {(lastUpdated || isLoadingFresh) && (
                            <DropdownMenuItem
                              onSelect={() => {
                                if (!isLoadingFresh) {
                                  // Clear portfolio growth calculator cache
                                  try {
                                    const keys = Object.keys(localStorage);
                                    keys.forEach(key => {
                                      if (key.startsWith('historical-prices-')) {
                                        localStorage.removeItem(key);
                                      }
                                    });
                                  } catch (e) {
                                    // Ignore errors
                                  }
                                  loadData(true);
                                }
                              }}
                              disabled={isLoadingFresh}
                              className="text-xs"
                            >
                              <div className={`font-medium mb-0.5 flex items-center gap-1.5 ${isLoadingFresh ? 'animate-pulse' : ''}`}>
                                <Clock className={`h-3 w-3 ${isLoadingFresh ? 'text-purple-500' : 'text-foreground'}`} />
                                <span className={isLoadingFresh ? 'bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 bg-clip-text text-transparent' : 'text-foreground'}>
                                  {isLoadingFresh ? 'Updating...' : 'Last Updated'}
                                </span>
                                {!isLoadingFresh && (
                                  <RefreshCw className="h-3 w-3 text-muted-foreground" />
                                )}
                              </div>
                              {lastUpdated && (
                                <div className={`break-words ${isLoadingFresh ? 'opacity-50' : ''}`}>
                                  {lastUpdated.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })} {lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
                                </div>
                              )}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  <div className="hidden min-[1251px]:flex items-center gap-3 flex-shrink-0">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-7 gap-2 px-2">
                          {isLoadingFresh ? (
                            <span className="text-xs animate-pulse bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 bg-clip-text text-transparent">
                              Updating...
                            </span>
                          ) : lastUpdated ? (
                            <span className="text-xs text-muted-foreground">
                              Updated {lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                            </span>
                          ) : null}
                          <MoreVertical className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-40" align="end">
                        {(lastUpdated || isLoadingFresh) && (
                          <DropdownMenuItem
                            onSelect={() => {
                              if (!isLoadingFresh) {
                                loadData(true);
                              }
                            }}
                            disabled={isLoadingFresh}
                            className="text-xs flex-col items-start"
                          >
                            <div className={`font-medium mb-0.5 flex items-center gap-1.5 ${isLoadingFresh ? 'animate-pulse' : ''}`}>
                              <Clock className={`h-3 w-3 ${isLoadingFresh ? 'text-purple-500' : 'text-foreground'}`} />
                              <span className={isLoadingFresh ? 'bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 bg-clip-text text-transparent' : 'text-foreground'}>
                                {isLoadingFresh ? 'Updating...' : 'Last Updated'}
                              </span>
                            </div>
                            {lastUpdated && (
                              <div className={`break-words ${isLoadingFresh ? 'opacity-50' : ''}`}>
                                {lastUpdated.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })} {lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
                              </div>
                            )}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Scrollable Content - Desktop only */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {/* Horizontal scroll container for ticker details and table */}
              <div className="overflow-x-auto min-w-0">
                {/* Ticker Details - Sticky below header */}
                <div ref={tickerDetailsRef} className="sticky top-0 z-30 bg-background border-b w-full max-w-full overflow-hidden">
                  <div className="px-4 py-3 w-full min-w-0 max-w-full">
                    <StockChart 
                      selectedStock={selectedStock} 
                      symbolMetadata={symbolMetadata}
                      isChartCollapsed={isChartCollapsed}
                      setIsChartCollapsed={setIsChartCollapsed}
                    />
                  </div>
                </div>

                {/* Table with sticky header */}
                <div>
                  <StockTable 
                    onRowClick={handleStockSelect} 
                    selectedStock={selectedStock}
                    watchlist={currentWatchlist}
                    isLoading={!dataLoaded}
                    stickyHeaderOffset={tickerDetailsHeight}
                    watchlists={watchlists}
                    activeWatchlist={activeWatchlist}
                    symbolMetadata={symbolMetadata}
                  />
                </div>
              </div>
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel 
          defaultSize={sidebarDefaultSize}
          minSize={Math.min(sidebarMinSize, 40)} 
          maxSize={40}
          onResize={(size) => setSidebarSize(size)}
        >
          <WatchlistSidebar
            symbolMetadata={symbolMetadata}
            tickerDetailsHeight={tickerDetailsHeight} 
            onStockSelect={handleStockSelect}
            selectedStock={selectedStock}
            watchlist={currentWatchlist}
            watchlistName={watchlists.find(wl => wl.id === activeWatchlist)?.name}
            onMinWidthChange={setSidebarMinWidth}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            isLoading={!dataLoaded}
            sidebarSize={sidebarSize}
            totalSymbolsCount={watchlistSymbols[activeWatchlist]?.length}
            watchlists={watchlists}
            activeWatchlistId={activeWatchlist}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
      </div>

      {/* Mobile: Simple layout without ResizablePanelGroup */}
      <div className="lg:hidden h-full flex flex-col overflow-hidden">
        <Tabs value={mainViewMode} onValueChange={(value) => setMainViewMode(value as "table" | "heatmap" | "chat")} className="h-full flex flex-col overflow-hidden">
          {/* Fixed Header Section: Header + Ticker Detail + Tabs */}
          <div className="flex-shrink-0 flex flex-col relative z-20 bg-background">
            {/* Header: Logo, Dropdown, Update Button */}
            <div className="flex-shrink-0 border-b bg-background">
              <div className="px-4 py-3 flex items-center">
                <div className="flex flex-col gap-3 w-full">
                  <div className="flex items-center gap-3 w-full min-w-0">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="transition-all rounded p-1 hover:bg-accent hover:opacity-80 flex-shrink-0 focus:outline-none focus:ring-0"
                          aria-label="Screener menu"
                          title="Screener menu"
                        >
                          <img 
                            src="/Screener.svg" 
                            alt="Screener logo" 
                            className="h-6 w-6"
                          />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-56" align="start">
                        <DropdownMenuItem onSelect={() => setShowDisclaimer(true)}>
                          <Power className="mr-2 h-4 w-4" />
                          Welcome to Screener
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <a href="/predictions" className="cursor-pointer">
                            <TrendingUp className="mr-2 h-4 w-4" />
                            Predictions
                          </a>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                          <a href="https://www.txl.app/projects" target="_blank" rel="noopener noreferrer" className="cursor-pointer flex items-center font-semibold">
                            <span className="mr-2 inline-block">
                              <Infinity className="h-4 w-4" style={{ 
                                stroke: 'url(#txl-gradient)',
                                fill: 'none'
                              }} />
                              <svg className="absolute w-0 h-0">
                                <defs>
                                  <linearGradient id="txl-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%" stopColor="#a855f7" />
                                    <stop offset="50%" stopColor="#ec4899" />
                                    <stop offset="100%" stopColor="#f97316" />
                                  </linearGradient>
                                </defs>
                              </svg>
                            </span>
                            <span className="text-xs bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 bg-clip-text text-transparent">
                              Maintained by TXL
                            </span>
                          </a>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-xs text-muted-foreground cursor-pointer"
                          onSelect={handleCopyVersion}
                        >
                          <span>
                            {versionCopied ? 'Copied!' : getVersionString()}
                          </span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {/* Mobile: Show dropdown with updating button */}
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <Select value={activeWatchlist} onValueChange={handleWatchlistChange}>
                          <SelectTrigger className="h-9 text-sm w-full">
                            <SelectValue placeholder="Select watchlist">
                              {watchlists.find(wl => wl.id === activeWatchlist)?.name || "Select watchlist"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {watchlists.map((wl) => {
                              return (
                                <SelectItem key={wl.id} value={wl.id} className="text-sm">
                                  {wl.name} ({wl.symbols.length})
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </div>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" className="h-7 gap-2 px-2 flex-shrink-0">
                            {isLoadingFresh ? (
                              <span className="text-xs animate-pulse bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 bg-clip-text text-transparent">
                                Updating...
                              </span>
                            ) : lastUpdated ? (
                              <span className="text-xs text-muted-foreground">
                                Updated {lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">Updated</span>
                            )}
                            <MoreVertical className="h-3.5 w-3.5" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-40 p-1.5" align="end">
                          <div className="space-y-1">
                            {(lastUpdated || isLoadingFresh) && (
                              <button
                                onClick={() => {
                                  if (!isLoadingFresh) {
                                    loadData(true);
                                  }
                                }}
                                  className="w-full text-left text-xs text-muted-foreground px-2 py-1.5 rounded-sm hover:bg-accent transition-colors disabled:cursor-not-allowed break-words"
                                disabled={isLoadingFresh}
                              >
                                <div className={`font-medium mb-0.5 flex items-center gap-1.5 ${isLoadingFresh ? 'animate-pulse' : ''}`}>
                                  <Clock className={`h-3 w-3 ${isLoadingFresh ? 'text-purple-500' : 'text-foreground'}`} />
                                  <span className={isLoadingFresh ? 'bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 bg-clip-text text-transparent' : 'text-foreground'}>
                                    {isLoadingFresh ? 'Updating...' : 'Last Updated'}
                                  </span>
                                </div>
                                {lastUpdated && (
                                  <div className={`break-words ${isLoadingFresh ? 'opacity-50' : ''}`}>
                                    {lastUpdated.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })} {lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
                                  </div>
                                )}
                              </button>
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Ticker Detail (StockChart) */}
            <div className="flex-shrink-0 border-b bg-background">
              <div className="p-4 w-full min-w-0">
                <StockChart 
                  selectedStock={selectedStock} 
                  symbolMetadata={symbolMetadata}
                  isChartCollapsed={isChartCollapsed}
                  setIsChartCollapsed={setIsChartCollapsed}
                />
              </div>
            </div>

            {/* Tabs */}
            <div className="flex-shrink-0 border-b bg-background">
              <div className="px-4 py-3">
                <TabsList className="grid w-full grid-cols-3 h-9">
                  <TabsTrigger value="table" className="text-xs gap-1.5">
                    <Table2 className="h-3.5 w-3.5" />
                    Equities
                  </TabsTrigger>
                  <TabsTrigger value="heatmap" className="text-xs gap-1.5">
                    <LayoutGrid className="h-3.5 w-3.5" />
                    Heatmap
                  </TabsTrigger>
                  <TabsTrigger value="chat" className="text-xs gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" />
                    Chat
                  </TabsTrigger>
                </TabsList>
              </div>
            </div>
          </div>

          {/* Scrollable Content Section */}
          <div className="flex-1 min-h-0 relative overflow-hidden">
            {/* Pull-to-refresh indicator - positioned in the pull space above content */}
            <div 
              className="absolute top-0 left-0 right-0 flex flex-col pointer-events-none"
              style={{
                height: `${pullToRefreshDistance}px`,
                transition: !isPulling ? 'height 0.3s ease-out, opacity 0.3s ease-out' : 'none',
                opacity: pullToRefreshDistance > 0 ? 1 : 0,
                overflow: 'hidden',
                zIndex: 1,
              }}
            >
              {/* Top spacing with fixed padding - grows as pull distance increases */}
              <div style={{ flex: 1, minHeight: 0, paddingTop: '16px' }} />
              {/* Indicator container with fixed bottom padding */}
              <div className="flex items-center justify-center" style={{ paddingBottom: '16px', flexShrink: 0 }}>
                <div className="flex flex-col items-center gap-2">
                  <RefreshCw 
                    className={`h-5 w-5 transition-all text-gray-400 ${
                      isLoadingFresh ? 'animate-spin' : ''
                    }`}
                    style={{
                      transform: isLoadingFresh 
                        ? 'rotate(0deg)' 
                        : `rotate(${pullToRefreshDistance * 4.5}deg)`,
                    }}
                  />
                  <span className="text-xs text-gray-400 transition-opacity whitespace-nowrap">
                    {isLoadingFresh ? 'Updating...' : 'Release to refresh'}
                  </span>
                </div>
              </div>
            </div>
            <div 
              ref={scrollableContentRef}
              className="h-full overflow-y-auto"
              style={{
                // Add pull-to-refresh transform with smooth transition
                transform: pullToRefreshDistance > 0 ? `translateY(${pullToRefreshDistance}px)` : 'translateY(0)',
                transition: pullToRefreshDistance === 0 && !isPulling ? 'transform 0.3s ease-out' : 'none',
              }}
            >
            <TabsContent value="table" className="m-0">
              <div>
                <StockTable 
                  onRowClick={handleStockSelect} 
                  selectedStock={selectedStock}
                  watchlist={currentWatchlist}
                  isLoading={!dataLoaded}
                  watchlists={watchlists}
                  activeWatchlist={activeWatchlist}
                  symbolMetadata={symbolMetadata}
                />
              </div>
            </TabsContent>
            <TabsContent value="heatmap" className="m-0">
              <div className="pb-24">
                <StockHeatmap
                  onStockSelect={handleStockSelect}
                  selectedStock={selectedStock}
                  watchlist={currentWatchlist}
                  isLoading={!dataLoaded}
                  sidebarSize={100}
                  watchlists={watchlists}
                  activeWatchlistId={activeWatchlist}
                />
              </div>
            </TabsContent>
            <TabsContent value="chat" className="m-0 h-full flex flex-col">
              <ChatSidebar
                selectedStock={selectedStock}
                watchlist={currentWatchlist}
                watchlistName={watchlists.find(wl => wl.id === activeWatchlist)?.name}
                onStockDeselect={() => handleStockSelect(null)}
                onStockSelect={handleStockSelect}
              />
            </TabsContent>
            </div>
          </div>
        </Tabs>
      </div>
    </div>
  )
}

export default App

