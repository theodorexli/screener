import { List, LayoutGrid, Sparkles } from "lucide-react";
import { type StockTicker } from "@/data/stockTickers";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BasicSidebar } from "@/components/BasicSidebar";
import { StockHeatmap } from "@/components/StockHeatmap";
import { ChatSidebar } from "@/components/ChatSidebar";

interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
}

interface WatchlistSidebarProps {
  onStockSelect: (stock: StockTicker | null) => void;
  selectedStock: StockTicker | null;
  watchlist: StockTicker[];
  watchlistName?: string;
  onMinWidthChange?: (minWidth: number) => void;
  viewMode?: "table" | "heatmap" | "chat";
  onViewModeChange?: (mode: "table" | "heatmap" | "chat") => void;
  isLoading?: boolean;
  sidebarSize?: number;
  symbolMetadata?: Record<string, { longName?: string; website?: string; allocateAgressive?: number }>;
  tickerDetailsHeight?: number;
  totalSymbolsCount?: number; // Total number of symbols in watchlist from Notion
  watchlists?: Watchlist[]; // All watchlists for background fetching
  activeWatchlistId?: string; // Active watchlist ID for prioritizing
}

export function WatchlistSidebar({ 
  onStockSelect, 
  selectedStock, 
  watchlist,
  watchlistName,
  viewMode = "table",
  onViewModeChange,
  isLoading = false,
  sidebarSize = 20,
  symbolMetadata = {},
  tickerDetailsHeight,
  totalSymbolsCount,
  watchlists,
  activeWatchlistId,
}: WatchlistSidebarProps) {
  
  const handleTabChange = (value: string) => {
    if (onViewModeChange) {
      onViewModeChange(value as "table" | "heatmap" | "chat");
    }
  };

  return (
    <div className="border-l bg-background h-screen flex flex-col w-full">
      <Tabs 
        value={viewMode || "heatmap"} 
        onValueChange={handleTabChange} 
        className="flex flex-col h-full"
      >
        {/* Header Section */}
        <div className="flex-shrink-0 border-b bg-background z-10 h-[64px]">
          <div className="px-4 py-3 flex items-center h-full">
            <TabsList className="grid w-full grid-cols-3 h-9">
              <TabsTrigger value="table" className="text-xs gap-1.5">
                <List className="h-3.5 w-3.5" />
                Basic
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

        {/* Basic Tab Content */}
        {viewMode === "table" && (
          <BasicSidebar
            onStockSelect={onStockSelect}
            selectedStock={selectedStock}
            watchlist={watchlist}
            isLoading={isLoading}
            symbolMetadata={symbolMetadata}
            tickerDetailsHeight={tickerDetailsHeight}
            totalSymbolsCount={totalSymbolsCount}
          />
        )}

        {/* Heatmap Tab Content */}
        {viewMode === "heatmap" && (
          <StockHeatmap
            onStockSelect={onStockSelect}
            selectedStock={selectedStock}
            watchlist={watchlist}
            isLoading={isLoading}
            sidebarSize={sidebarSize}
            symbolMetadata={symbolMetadata || {}}
            totalSymbolsCount={totalSymbolsCount}
            watchlists={watchlists}
            activeWatchlistId={activeWatchlistId}
          />
        )}

        {/* Chat Tab Content */}
        {viewMode === "chat" && (
          <ChatSidebar
            selectedStock={selectedStock}
            watchlist={watchlist}
            watchlistName={watchlistName}
            onStockDeselect={() => onStockSelect(null)}
            onStockSelect={onStockSelect}
          />
        )}
      </Tabs>
    </div>
  );
}
