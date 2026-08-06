/**
 * API Service Layer
 * 
 * This module handles all API calls to the Cloudflare Worker backend.
 */

import { StockTicker } from '@/data/stockTickers';

// Worker URL - use environment variable or default to relative path (for Vite proxy)
// In production, this should be set to the deployed worker URL
// Set via VITE_WORKER_URL environment variable in GitLab CI
const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';
// In production, set VITE_PREDICTIONS_WORKER_URL (GitLab CI does this for TXL).
// Locally, leave empty to use the Vite proxy.
const PREDICTIONS_WORKER_URL = import.meta.env.VITE_PREDICTIONS_WORKER_URL || '';

// Debug: Log the worker URL in development (will be stripped in production build)
if (import.meta.env.DEV) {
  console.log('🔧 Worker URL:', WORKER_URL || '(using Vite proxy)');
  console.log('🔧 Predictions worker URL:', PREDICTIONS_WORKER_URL || '(using Vite proxy for /api/predictions)');
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

interface WatchlistsConfig {
  defaultFavorites?: string[];
  defaultSort?: {
    column: string;
    direction: string;
  };
  watchlists: Array<{
    id: string;
    name: string;
    symbols: string[];
  }>;
  symbolMetadata?: Record<string, { longName?: string; website?: string; allocateAgressive?: number }>;
}

interface TableConfig {
  defaultSort?: {
    column: string;
    direction: string;
  };
  defaultColorRules?: {
    [key: string]: Array<{
      operator: string;
      value?: number; // Optional for VWAP operators
      color: string;
    }>;
  };
}

/**
 * Fetch stock data for given symbols from the worker
 * Includes chart history data for each stock
 */
export async function fetchStockData(symbols: string[]): Promise<StockTicker[]> {
  try {
    const symbolsParam = symbols.join(',');
    const baseUrl = WORKER_URL || ''; // Empty string means relative path (uses Vite proxy)
    const url = `${baseUrl}/api/stocks?symbols=${encodeURIComponent(symbolsParam)}&includeHistory=true`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }
    
    const result: ApiResponse<StockTicker[]> = await response.json();
    
    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to fetch stock data');
    }
    
    return result.data;
  } catch (error) {
    
    // Return empty array - the API should be working now with Alpaca
    return [];
  }
}

/**
 * Fetch watchlists configuration from the worker
 */
export async function fetchWatchlists(): Promise<WatchlistsConfig> {
  try {
    const baseUrl = WORKER_URL || ''; // Empty string means relative path (uses Vite proxy)
    const url = `${baseUrl}/api/watchlists`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }
    
    const data: WatchlistsConfig = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching watchlists from API:', error);
    
    // Final fallback: Return minimal default configuration
    return {
      defaultFavorites: ["txl"],
      watchlists: [
        {
          id: "txl",
          name: "Holdings",
          symbols: []
        }
      ]
    };
  }
}

/**
 * Fetch table configuration from the worker
 */
export async function fetchTableConfig(): Promise<TableConfig> {
  try {
    const baseUrl = WORKER_URL || ''; // Empty string means relative path (uses Vite proxy)
    const url = `${baseUrl}/api/config`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }
    
    const data: TableConfig = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching table config from API:', error);
    
    // Fallback to local table.json in public folder
    try {
      const localResponse = await fetch('/table.json', { cache: 'no-store' });
      if (localResponse.ok) {
        const localData: TableConfig = await localResponse.json();
        return localData;
      }
    } catch (localError) {
      console.error('Error loading local table config:', localError);
    }
    
    // Final fallback: Return default configuration
    return {
      defaultColorRules: {}
    };
  }
}

/**
 * Batch fetch stock data with retry logic
 * Useful for large watchlists
 */
export async function batchFetchStockData(
  symbols: string[], 
  batchSize: number = 50
): Promise<StockTicker[]> {
  const batches: string[][] = [];
  
  // Split symbols into batches
  for (let i = 0; i < symbols.length; i += batchSize) {
    batches.push(symbols.slice(i, i + batchSize));
  }
  
  // Fetch all batches in parallel
  const results = await Promise.all(
    batches.map(batch => fetchStockData(batch))
  );
  
  // Flatten results
  return results.flat();
}

/**
 * Get the logo URL for a stock symbol
 * Returns a URL that can be used as an image src
 */
export function getLogoUrl(symbol: string): string {
  const baseUrl = WORKER_URL || ''; // Empty string means relative path (uses Vite proxy)
  return `${baseUrl}/api/logos/${encodeURIComponent(symbol.toUpperCase())}`;
}

/**
 * News article interface based on Alpaca API response
 */
export interface NewsArticleApi {
  id: number;
  headline: string;
  author: string;
  created_at: string;
  updated_at: string;
  summary: string;
  url: string;
  images?: Array<{
    size: string;
    url: string;
  }>;
  symbols?: string[];
  source: string;
}

/**
 * Fetch news articles from Alpaca
 * @param options Optional parameters for filtering news
 */
export async function fetchNews(options?: {
  symbols?: string[];
  limit?: number;
  start?: string;
  end?: string;
}): Promise<NewsArticleApi[]> {
  try {
    const baseUrl = WORKER_URL || ''; // Empty string means relative path (uses Vite proxy)
    let url: string;
    
    if (baseUrl) {
      const urlObj = new URL(`${baseUrl}/api/news`);
      if (options?.symbols && options.symbols.length > 0) {
        urlObj.searchParams.set('symbols', options.symbols.join(','));
      }
      if (options?.limit) {
        urlObj.searchParams.set('limit', options.limit.toString());
      }
      if (options?.start) {
        urlObj.searchParams.set('start', options.start);
      }
      if (options?.end) {
        urlObj.searchParams.set('end', options.end);
      }
      url = urlObj.toString();
    } else {
      // Relative URL - build query string manually
      const params = new URLSearchParams();
      if (options?.symbols && options.symbols.length > 0) {
        params.set('symbols', options.symbols.join(','));
      }
      if (options?.limit) {
        params.set('limit', options.limit.toString());
      }
      if (options?.start) {
        params.set('start', options.start);
      }
      if (options?.end) {
        params.set('end', options.end);
      }
      const queryString = params.toString();
      url = `/api/news${queryString ? `?${queryString}` : ''}`;
    }
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }
    
    const result: ApiResponse<NewsArticleApi[]> = await response.json();
    
    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to fetch news');
    }
    
    return result.data;
  } catch (error) {

    return [];
  }
}

/**
 * Chat message interface
 */
export interface ChatMessageRequest {
  message: string;
  // Legacy single stock fields (optional for backward compatibility)
  stockSymbol?: string;
  stockName?: string;
  stockData?: {
    price: number;
    change: number;
    changePercent: number;
    volume: number;
    rsi?: number;
    macd?: number;
    vwap?: number;
    priceHistory?: Array<{
      date: string;
      price: number;
      vwap?: number;
    }>;
  };
  // New watchlist context fields
  watchlistName?: string;
  watchlist?: Array<{
    symbol: string;
    name: string;
    stockData?: {
      price: number;
      change: number;
      changePercent: number;
      volume: number;
      rsi?: number;
      macd?: number;
      vwap?: number;
      priceHistory?: Array<{
        date: string;
        price: number;
        vwap?: number;
      }>;
    };
  }>;
  selectedStockSymbol?: string;
  selectedStockName?: string;
  conversationHistory: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  // Optional: News articles to summarize (when user asks to summarize fetched news)
  newsArticles?: Array<{
    headline: string;
    summary: string;
    url: string;
    date: string;
    source: string;
  }>;
}

/**
 * News article interface (for function calls and display)
 */
export interface NewsArticle {
  id?: number; // Unique article ID for deduplication
  headline: string;
  summary: string;
  url: string;
  date: string;
  source: string;
  symbols?: string[]; // Tickers that this article relates to
}


/**
 * Function call callback type
 */
export type FunctionCallCallback = (data: {
  name: string;
  symbol?: string;
  articles?: NewsArticle[];
}) => void;

/**
 * Metadata callback type
 */
export type MetadataCallback = (data: {
  showSources?: boolean;
}) => void;

/**
 * Send a chat message to the AI assistant with streaming support
 */
export async function sendChatMessage(
  request: ChatMessageRequest,
  onChunk?: (text: string) => void,
  onFunctionCall?: FunctionCallCallback,
  onMetadata?: MetadataCallback
): Promise<string> {
  const FETCH_TIMEOUT = 30000; // 30 seconds for initial fetch
  const STREAM_TIMEOUT = 120000; // 2 minutes for stream reading
  
  // Create AbortController for fetch timeout
  const fetchAbortController = new AbortController();
  const fetchTimeoutId = setTimeout(() => {
    fetchAbortController.abort();
  }, FETCH_TIMEOUT);
  
  try {
    const baseUrl = WORKER_URL || ''; // Empty string means relative path (uses Vite proxy)
    const url = baseUrl ? `${baseUrl}/api/chat` : '/api/chat';
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      cache: 'no-store', // Prevent browser caching
      signal: fetchAbortController.signal,
    });
    
    // Clear fetch timeout once we get a response
    clearTimeout(fetchTimeoutId);
    
    if (!response.ok) {
      // Try to get error message from response body
      let errorMessage = `API error: ${response.status} ${response.statusText}`;
      let retryAfter: number | undefined;
      
      try {
        const errorData = await response.json();
        if (errorData.error || errorData.message) {
          // For rate limits, use the user-friendly message
          if (response.status === 429) {
            errorMessage = errorData.message || 'Rate limit exceeded. Please wait a moment and try again.';
            retryAfter = errorData.retryAfter;
            if (retryAfter) {
              errorMessage += ` Please try again in ${retryAfter} second${retryAfter !== 1 ? 's' : ''}.`;
            }
          } else {
            errorMessage = errorData.message || errorData.error || errorMessage;
          }
        }
      } catch (e) {
        // If response isn't JSON, just use status text
        const errorText = await response.text().catch(() => '');
        if (errorText) {
          if (response.status === 429) {
            errorMessage = 'Rate limit exceeded. Please wait a moment and try again.';
          } else {
            errorMessage = `${errorMessage} - ${errorText.substring(0, 200)}`;
          }
        }
      }
      
      // Check Retry-After header if available
      if (response.status === 429 && !retryAfter) {
        const retryAfterHeader = response.headers.get('Retry-After');
        if (retryAfterHeader) {
          retryAfter = parseInt(retryAfterHeader, 10);
          if (!isNaN(retryAfter)) {
            errorMessage += ` Please try again in ${retryAfter} second${retryAfter !== 1 ? 's' : ''}.`;
          }
        }
      }
      
      throw new Error(errorMessage);
    }

    // Check if response is streaming (text/event-stream) or JSON
    const contentType = response.headers.get('content-type') || '';
    
    if (contentType.includes('text/event-stream')) {
      // Handle streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (!reader) {
        throw new Error('No response body');
      }

      let fullText = '';
      let receivedFunctionCall = false;
      let buffer = '';
      let streamError: Error | null = null;

      // Set up timeout to prevent infinite waiting on stream
      const streamTimeoutId = setTimeout(() => {
        if (!streamError) {
          streamError = new Error('Error: Timeout. Try again later.');
          reader.cancel().catch(err => {
            console.warn('Error canceling reader:', err);
          });
        }
      }, STREAM_TIMEOUT);

      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                continue;
              }
              
              try {
                const json = JSON.parse(data);
                
                
                if (json.type === 'chunk' && json.text) {
                  // The worker already sends deltas, so we can append directly
                  const chunk = json.text;
                  fullText += chunk;
                  onChunk?.(chunk);
                } else if (json.type === 'function_call_start') {
                  // Handle function call start (before fetching)
                  onFunctionCall?.({
                    name: json.name,
                    symbol: json.symbol,
                    articles: undefined // No articles yet
                  });
                } else if (json.type === 'function_call') {
                  // Handle function calls with results (e.g., fetch_news)
                  // Mark that we received a function call - this counts as data received
                  receivedFunctionCall = true;
                  if (!json.articles || json.articles.length === 0) {
                    console.warn('⚠️ No articles found', json);
                  }
                  onFunctionCall?.({
                    name: json.name,
                    symbol: json.symbol,
                    articles: json.articles
                  });
                } else if (json.type === 'metadata') {
                  // Handle metadata (e.g., showSources flag)
                  console.log('📚 Metadata received:', json);
                  onMetadata?.({
                    showSources: json.showSources
                  });
                } else if (json.type === 'error') {
                  // Track the error and throw it after the stream completes
                  const errorMessage = json.message || 'Streaming error';
                  console.error('Stream error received:', errorMessage);
                  streamError = new Error(errorMessage);
                  // Don't throw immediately - let the stream complete first
                }
              } catch (e) {
                // If it's our error from above, re-throw it
                if (e instanceof Error && (e.message.includes('Streaming error') || e.message.includes('No data received'))) {
                  throw e;
                }
                // Skip invalid JSON
                continue;
              }
            }
          }
        }
      } catch (readError) {
        // If reader was canceled or timed out, use the streamError
        if (streamError) {
          throw streamError;
        }
        // Otherwise, re-throw the read error
        if (readError instanceof Error) {
          throw readError;
        }
        throw new Error(String(readError));
      } finally {
        // Clear timeout when stream completes
        clearTimeout(streamTimeoutId);
      }

      // If we got a stream error, always throw it (even if there's partial text)
      if (streamError) {
        throw streamError;
      }

      // If we got no text and no function call, throw a generic error
      if (!fullText && !receivedFunctionCall) {
        throw new Error("I'm sorry, I couldn't generate a response. Please try again.");
      }
      
      return fullText;
    } else {
      // Handle non-streaming JSON response (fallback)
      const result: ApiResponse<{ response: string }> = await response.json();
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to get chat response');
      }
      
      return result.data?.response || '';
    }
  } catch (error) {
    // Clear fetch timeout if it's still pending
    clearTimeout(fetchTimeoutId);
    
    // Handle abort errors
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Error: Timeout. Try again later.');
    }

    throw error;
  }
}

export interface PredictionMarketQuote {
  platform: 'kalshi' | 'polymarket';
  id: string;
  eventId: string;
  title: string;
  yesAsk: number | null;
  noAsk: number | null;
  volume: number;
  url: string;
  eventDate?: string | null;
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
  kalshi: PredictionMarketQuote;
  polymarket: PredictionMarketQuote;
  strategies: ArbitrageStrategy[];
  bestProfit: number;
  bestStrategy: ArbitrageStrategy | null;
}

export interface ScanMarketQuote {
  id: string;
  title: string;
  yesAsk: number;
  noAsk: number;
  url: string;
  eventDate?: string | null;
}

export interface ScanResult {
  matchScore: number | null;
  title: string;
  kalshi: ScanMarketQuote;
  polymarket: ScanMarketQuote | null;
  bestProfit: number | null;
}

export interface PredictionsResponse {
  exchangeStatus: {
    kalshi: {
      exchangeActive: boolean;
      tradingActive: boolean;
      estimatedResumeTime?: string | null;
    };
  };
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

function predictionsUrl(path: string): string {
  const baseUrl = PREDICTIONS_WORKER_URL || '';
  return baseUrl ? `${baseUrl}${path}` : path;
}

/**
 * Fetch cross-platform arbitrage opportunities (Kalshi + Polymarket)
 */
export async function fetchPredictions(options?: {
  limit?: number;
  minProfit?: number;
  scanTarget?: number;
  scanOffset?: number;
  scanLimit?: number;
}): Promise<PredictionsResponse> {
  const params = new URLSearchParams();
  if (options?.limit) {
    params.set('limit', options.limit.toString());
  }
  if (options?.minProfit !== undefined) {
    params.set('min_profit', options.minProfit.toString());
  }
  if (options?.scanTarget) {
    params.set('scan_target', options.scanTarget.toString());
  }
  if (options?.scanOffset !== undefined) {
    params.set('scan_offset', options.scanOffset.toString());
  }
  if (options?.scanLimit) {
    params.set('scan_limit', options.scanLimit.toString());
  }
  const queryString = params.toString();
  const url = `${predictionsUrl('/api/predictions/markets')}${queryString ? `?${queryString}` : ''}`;

  const response = await fetch(url, { cache: 'no-store' });
  const contentType = response.headers.get('content-type') || '';

  if (!response.ok) {
    if (response.status === 503) {
      throw new Error('Predictions scan is warming up — retry in a few seconds');
    }
    throw new Error(`Predictions API error (${response.status})`);
  }

  if (!contentType.includes('application/json')) {
    throw new Error('Predictions API unavailable');
  }

  const result = await response.json() as {
    success?: boolean;
    data?: Partial<PredictionsResponse> & { predictions?: ArbitrageOpportunity[] };
    error?: string;
    message?: string;
  };

  if (!response.ok || !result.success || !result.data) {
    throw new Error(result.message || result.error || 'Failed to fetch predictions');
  }

  const data = result.data;
  return {
    exchangeStatus: data.exchangeStatus ?? {
      kalshi: { exchangeActive: true, tradingActive: true },
    },
    opportunities: data.opportunities ?? data.predictions ?? [],
    scanResults: data.scanResults ?? [],
    scanResultsTotal: data.scanResultsTotal ?? data.scanResults?.length ?? 0,
    scanOffset: data.scanOffset ?? 0,
    scanLimit: data.scanLimit ?? data.scanResults?.length ?? 0,
    kalshiMarketCount: data.kalshiMarketCount ?? 0,
    kalshiOpenMarketCount: data.kalshiOpenMarketCount ?? data.kalshiMarketCount ?? 0,
    polymarketMarketCount: data.polymarketMarketCount ?? 0,
    matchedPairs: data.matchedPairs ?? 0,
    matchedScanResults: data.matchedScanResults ?? [],
    minProfitThreshold: data.minProfitThreshold ?? 0,
    fetchedAt: data.fetchedAt ?? new Date().toISOString(),
  };
}

