import { useState, useEffect, useRef, useMemo } from "react";
import { Sparkles, Loader2, RotateCcw, User, CopyIcon, CheckIcon, ExternalLink, Calendar, Newspaper } from "lucide-react";
import { type StockTicker } from "@/data/stockTickers";
import { sendChatMessage, fetchNews, fetchStockData } from "@/services/api";
import type { NewsArticle } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import { Actions, Action } from "@/components/ui/ai-actions";
import { Tool, ToolHeader, ToolContent, ToolOutput } from "@/components/ui/ai/tool";
import { Sources, SourcesTrigger, SourcesContent, Source } from "@/components/ui/ai/sources";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  showSources?: boolean;
  error?: string;
}

interface ToolExecution {
  id: string;
  type: string;
  symbol?: string;
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
  articles?: NewsArticle[];
  timestamp: Date;
  messageIndex?: number; // Associate with message index
}

interface ChatSidebarProps {
  selectedStock: StockTicker | null;
  watchlist: StockTicker[];
  watchlistName?: string;
  onStockDeselect?: () => void;
  onStockSelect?: (stock: StockTicker) => void;
}

// NewsTool component (moved from separate file)
function NewsTool({ 
  articles, 
  state = 'output-available',
  defaultOpen = true,
  className 
}: { 
  articles: NewsArticle[]; 
  state?: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
  defaultOpen?: boolean;
  className?: string;
}) {
  const [visibleArticles, setVisibleArticles] = useState<NewsArticle[]>([]);

  // Deduplicate articles by ID or URL
  const uniqueArticles = useMemo(() => {
    if (!articles || articles.length === 0) {
      return [];
    }
    const articleMap = new Map<string, NewsArticle>();
    articles.forEach(article => {
      const key = article.id?.toString() || article.url;
      if (!articleMap.has(key)) {
        articleMap.set(key, article);
      }
    });
    return Array.from(articleMap.values());
  }, [articles]);

  useEffect(() => {
    if (uniqueArticles.length === 0) {
      setVisibleArticles([]);
      return;
    }

    // Show articles one by one with staggered animation
    setVisibleArticles([]);
    uniqueArticles.forEach((article, index) => {
      setTimeout(() => {
        setVisibleArticles((prev) => {
          // Prevent duplicates in visible articles too
          const key = article.id?.toString() || article.url;
          const alreadyVisible = prev.some(a => (a.id?.toString() || a.url) === key);
          if (alreadyVisible) {
            return prev;
          }
          return [...prev, article];
        });
      }, index * 100); // 100ms delay between each article
    });
  }, [uniqueArticles]);

  if (!articles || articles.length === 0) {
    return null;
  }

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) {
        return dateString;
      }
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      });
    } catch {
      return dateString;
    }
  };

  return (
    <Tool defaultOpen={defaultOpen} className={cn("mb-4", className)}>
      <ToolHeader 
        type="Fetching news articles"
        state={state}
        articleCount={state === 'output-available' ? uniqueArticles.length : undefined}
      />
      <ToolContent>
        <ToolOutput
          articleCount={visibleArticles.length}
          output={
            <div className="space-y-3">
              <div className="grid gap-3">
                {visibleArticles.map((article, index) => {
                  // Use article ID or URL as key for proper React reconciliation
                  const articleKey = article.id?.toString() || article.url || `article-${index}`;
                  return (
                  <Card 
                    key={articleKey} 
                    className={cn(
                      "hover:shadow-md transition-all border-border/50 bg-card",
                      "animate-in fade-in slide-in-from-bottom-2 duration-300"
                    )}
                    style={{
                      animationDelay: `${index * 100}ms`,
                    }}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-sm font-semibold leading-tight line-clamp-2">
                          {article.headline}
                        </CardTitle>
                        {article.url && (
                          <a
                            href={article.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2 flex-wrap">
                        {article.symbols && article.symbols.length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap">
                            {article.symbols.slice(0, 3).map((symbol) => (
                              <span 
                                key={symbol}
                                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary"
                              >
                                {symbol}
                              </span>
                            ))}
                            {article.symbols.length > 3 && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground">
                                +{article.symbols.length - 3}
                              </span>
                            )}
                          </div>
                        )}
                        {article.source && (
                          <span className="flex items-center gap-1">
                            <Newspaper className="h-3 w-3" />
                            {article.source}
                          </span>
                        )}
                        {article.date && article.date !== 'Unknown date' && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatDate(article.date)}
                          </span>
                        )}
                      </div>
                    </CardHeader>
                    {article.summary && article.summary !== 'No summary available' && (
                      <CardContent className="pt-0">
                        <CardDescription className="text-xs leading-relaxed line-clamp-3">
                          {article.summary}
                        </CardDescription>
                      </CardContent>
                    )}
                  </Card>
                  );
                })}
              </div>
            </div>
          }
        />
      </ToolContent>
    </Tool>
  );
}

export function ChatSidebar({ selectedStock, watchlist, watchlistName, onStockDeselect, onStockSelect }: ChatSidebarProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [toolExecutions, setToolExecutions] = useState<ToolExecution[]>([]);
  const [inputValue, setInputValue] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const newsTriggeredForMessageRef = useRef<Set<number>>(new Set());

  // Auto-resize textarea - grow to 5 lines max on desktop, 3 lines on mobile, then scroll
  useEffect(() => {
    const updateTextareaHeight = () => {
      if (textareaRef.current) {
        // Reset height to auto to get accurate scrollHeight
        textareaRef.current.style.height = "44px";
        // Then set to auto to calculate
        textareaRef.current.style.height = "auto";
        // Calculate max height: 5 lines on desktop (lg: 1024px+), 3 lines on mobile
        // 1 line = 44px, each additional line = 20px line height
        // 3 lines: 44px + (2 * 20px) = 84px
        // 5 lines: 44px + (4 * 20px) = 124px
        const isDesktop = window.innerWidth >= 1024;
        const maxHeight = isDesktop ? 124 : 84;
        textareaRef.current.style.maxHeight = `${maxHeight}px`;
        const newHeight = Math.min(textareaRef.current.scrollHeight, maxHeight);
        textareaRef.current.style.height = `${newHeight}px`;
      }
    };

    updateTextareaHeight();
    
    // Handle window resize
    window.addEventListener('resize', updateTextareaHeight);
    return () => window.removeEventListener('resize', updateTextareaHeight);
  }, [inputValue]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Debug: Log tool executions
  useEffect(() => {
    if (toolExecutions.length > 0) {
      console.log('📰 Tool executions:', toolExecutions.map(t => ({
        id: t.id,
        type: t.type,
        symbol: t.symbol,
        state: t.state,
        articlesCount: t.articles?.length || 0
      })));
    }
  }, [toolExecutions]);

  // Focus textarea when component mounts or when selected stock changes
  useEffect(() => {
    textareaRef.current?.focus();
  }, [selectedStock]);

  // Create a stable identifier for the watchlist based on symbols (not data)
  const watchlistId = useMemo(() => {
    if (!watchlist || watchlist.length === 0) return null;
    return watchlist.map(s => s.symbol).sort().join(',');
  }, [watchlist]);

  // Memoize random ticker selection - only changes when watchlist changes
  const randomTicker = useMemo(() => {
    if (!watchlist || watchlist.length === 0) return null;
    const randomIndex = Math.floor(Math.random() * watchlist.length);
    return watchlist[randomIndex].symbol;
  }, [watchlistId]); // Only recalculate when watchlist symbols change

  // Track the last watchlist ID, selected stock, and watchlist name to detect actual changes
  const lastWatchlistIdRef = useRef<string | null>(null);
  const lastSelectedStockSymbolRef = useRef<string | null>(null);
  const lastWatchlistNameRef = useRef<string | undefined>(undefined);

  // Add welcome message when watchlist identity changes (not on data updates)
  useEffect(() => {
    const watchlistChanged = watchlistId !== lastWatchlistIdRef.current;
    const selectedStockChanged = selectedStock?.symbol !== lastSelectedStockSymbolRef.current;
    const watchlistNameChanged = watchlistName !== lastWatchlistNameRef.current;
    
    // Only reset if watchlist identity, selected stock, or watchlist name actually changed
    if (watchlistChanged || (selectedStockChanged && watchlistId !== null) || (watchlistNameChanged && watchlistId !== null)) {
      lastWatchlistIdRef.current = watchlistId;
      lastSelectedStockSymbolRef.current = selectedStock?.symbol || null;
      lastWatchlistNameRef.current = watchlistName;
      
      if (watchlist && watchlist.length > 0) {
        const displayName = watchlistName || 'this watchlist';
        if (selectedStock) {
          setMessages([
            {
              role: "assistant",
              content: `Hello! Ask me questions about $${selectedStock.symbol} or any stock in ${displayName}. Anything you want to know?`,
              timestamp: new Date(),
            },
          ]);
        } else {
          setMessages([
            {
              role: "assistant",
              content: `Hello! Ask me questions about any stock in ${displayName} (${watchlist.length} stocks). What would you like to know?`,
              timestamp: new Date(),
            },
          ]);
        }
        // Clear tool executions when watchlist/stock changes
        setToolExecutions([]);
      } else {
        setMessages([]);
        setToolExecutions([]);
      }
      setInputValue("");
    } else if (watchlistId === null) {
      // Watchlist was removed
      setMessages([]);
      setToolExecutions([]);
      lastWatchlistIdRef.current = null;
      lastSelectedStockSymbolRef.current = null;
      lastWatchlistNameRef.current = undefined;
    }
  }, [watchlistId, selectedStock?.symbol, watchlistName]);


  // Helper function to highlight tickers and watchlist names with gradient
  const highlightTickersAndWatchlists = (text: string): string => {
    if (!watchlist || watchlist.length === 0) return text;
    
    // Get all ticker symbols from watchlist
    const tickers = watchlist.map(s => s.symbol);
    const watchlistNameToHighlight = watchlistName;
    
    let highlighted = text;
    
    // Highlight ticker symbols (e.g., $AAPL, AAPL)
    tickers.forEach(ticker => {
      // Match ticker with $ prefix or standalone (word boundary)
      const tickerRegex = new RegExp(`\\$${ticker}\\b|\\b${ticker}\\b`, 'gi');
      highlighted = highlighted.replace(tickerRegex, (match, offset) => {
        // Don't replace if already inside a markdown link or code block
        const beforeMatch = highlighted.substring(0, offset);
        
        // Check if we're inside a markdown link [text](url) or code block
        const openBrackets = (beforeMatch.match(/\[/g) || []).length;
        const closeBrackets = (beforeMatch.match(/\]/g) || []).length;
        const openParens = (beforeMatch.match(/\(/g) || []).length;
        const closeParens = (beforeMatch.match(/\)/g) || []).length;
        const openCode = (beforeMatch.match(/```/g) || []).length;
        
        if (openBrackets > closeBrackets || (openBrackets === closeBrackets && openParens > closeParens) || openCode % 2 !== 0) {
          return match; // Inside a link or code block, don't replace
        }
        
        return `**${match}**`;
      });
    });
    
    // Highlight watchlist name if it exists
    if (watchlistNameToHighlight) {
      const watchlistRegex = new RegExp(`\\b${watchlistNameToHighlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      highlighted = highlighted.replace(watchlistRegex, (match) => {
        // Don't replace if already inside a markdown link or code block
        const beforeMatch = highlighted.substring(0, highlighted.indexOf(match));
        const openBrackets = (beforeMatch.match(/\[/g) || []).length;
        const closeBrackets = (beforeMatch.match(/\]/g) || []).length;
        const openCode = (beforeMatch.match(/```/g) || []).length;
        
        if (openBrackets > closeBrackets || openCode % 2 !== 0) {
          return match;
        }
        
        return `**${match}**`;
      });
    }
    
    return highlighted;
  };

  // Helper function to convert plain URLs to markdown links
  const linkifyUrls = (text: string): string => {
    // Match URLs - pattern matches:
    // 1. http:// or https:// followed by valid URL characters
    // 2. www. followed by domain and path
    // 3. txl.app specifically (with optional subdomain, path, etc.)
    // Valid URL chars: alphanumeric, dots, slashes, hyphens, underscores, equals, ampersands, query params
    // Exclude trailing punctuation: ), !, ?, ., ,, ;, : (when not part of URL structure)
    const urlRegex = /(https?:\/\/[a-zA-Z0-9._~:/?#[\]@$&'*+=%-]+|www\.[a-zA-Z0-9._~:/?#[\]@$&'*+=%-]+|(?:[a-zA-Z0-9-]+\.)?txl\.app(?:\/[a-zA-Z0-9._~:/?#[\]@$&'*+=%-]*)?)/g;
    
    return text.replace(urlRegex, (match, _p1, offset, fullString) => {
      // Check if already in markdown link format
      const beforeMatch = fullString.substring(Math.max(0, offset - 2), offset);
      const afterMatch = fullString.substring(offset + match.length, offset + match.length + 2);
      
      // Skip if already part of a markdown link [text](url) or (url)
      if (beforeMatch.includes('[') || (beforeMatch.includes('(') && afterMatch.includes(')'))) {
        return match;
      }
      
      // Remove trailing punctuation that shouldn't be part of URL
      // Common trailing punctuation: ), !, ?, ., ,, ;, :
      // Note: Period at end of sentence should not be part of URL
      let cleanUrl = match.replace(/[)!?.,;:]+$/, '');
      
      // Special case: if URL ends with a period and it's not part of the domain (like .com)
      // and there's punctuation after, remove it
      if (cleanUrl.endsWith('.') && !cleanUrl.match(/\.(app|com|org|net|io|co|dev)$/)) {
        cleanUrl = cleanUrl.slice(0, -1);
      }
      
      // Determine the href - add https:// if needed
      let href = cleanUrl;
      if (cleanUrl.startsWith('www.')) {
        href = `https://${cleanUrl}`;
      } else if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
        // Bare domain like txl.app - add https://
        href = `https://${cleanUrl}`;
      }
      return `[${cleanUrl}](${href})`;
    });
  };

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading || !watchlist || watchlist.length === 0) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: inputValue.trim(),
      timestamp: new Date(),
    };

    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInputValue("");
    setIsLoading(true);

    // Create assistant message placeholder for streaming
    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: "",
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, assistantMessage]);

    // News queries will be handled by the backend with watchlist context

    // Check if this is an identity/TXL query and set showSources flag
    const isIdentityQuery = (message: string): boolean => {
      const lowerMessage = message.toLowerCase();
      const identityKeywords = [
        'who are you', 'what are you', 'tell me about you',
        'who made you', 'who created you',
        'what is txl', 'who is txl', 'tell me about txl',
        'what is this app', 'tell me about this app',
        'what is screener', 'tell me about screener'
      ];
      return identityKeywords.some(keyword => lowerMessage.includes(keyword));
    };

    const isTXLQuery = isIdentityQuery(userMessage.content);

    // Check if user is asking to summarize news articles
    const isSummaryRequest = (message: string): boolean => {
      const lowerMessage = message.toLowerCase();
      const summaryKeywords = [
        'summarize', 'summary', 'summarise', 'summaries',
        'what do these articles say', 'what are these articles about',
        'tell me about these articles', 'explain these articles'
      ];
      return summaryKeywords.some(keyword => lowerMessage.includes(keyword));
    };

    const shouldIncludeNewsArticles = isSummaryRequest(userMessage.content);

    // Collect news articles from tool executions if user wants a summary
    let newsArticlesToInclude: NewsArticle[] | undefined = undefined;
    if (shouldIncludeNewsArticles) {
      // Get all articles from recent tool executions (last 5 messages worth)
      const recentToolExecutions = toolExecutions
        .filter(tool => tool.type === 'fetch_news' && tool.articles && tool.articles.length > 0)
        .slice(-3); // Get last 3 tool executions
      
      if (recentToolExecutions.length > 0) {
        // Flatten all articles from recent tool executions
        // Limit to max 10 articles to avoid token limits
        const allArticles = recentToolExecutions.flatMap(tool => tool.articles || []);
        newsArticlesToInclude = allArticles.slice(0, 10);
        console.log('📰 Including news articles for summarization:', newsArticlesToInclude.length, '(limited from', allArticles.length, ')');
      }
    }

    try {
      // Prepare watchlist context with all stocks
      const watchlistContext = watchlist.map(stock => {
        const hasValidStockData = 
          stock.price !== undefined && 
          !isNaN(stock.price) &&
          stock.change !== undefined && 
          !isNaN(stock.change) &&
          stock.changePercent !== undefined && 
          !isNaN(stock.changePercent) &&
          stock.volume !== undefined && 
          !isNaN(stock.volume);

        return {
          symbol: stock.symbol,
          name: stock.name,
          ...(hasValidStockData && {
            stockData: {
              price: stock.price!,
              change: stock.change!,
              changePercent: stock.changePercent!,
              volume: stock.volume!,
              ...(stock.rsi !== undefined && !isNaN(stock.rsi) && { rsi: stock.rsi }),
              ...(stock.macd !== undefined && !isNaN(stock.macd) && { macd: stock.macd }),
              ...(stock.vwap !== undefined && !isNaN(stock.vwap) && { vwap: stock.vwap }),
              ...(stock.priceHistory && { priceHistory: stock.priceHistory }),
            }
          })
        };
      });

      const requestPayload = {
        message: userMessage.content,
        watchlistName: watchlistName || 'the current watchlist',
        watchlist: watchlistContext,
        // Include selected stock if available (for backward compatibility and context)
        ...(selectedStock && {
          selectedStockSymbol: selectedStock.symbol,
          selectedStockName: selectedStock.name,
          stockSymbol: selectedStock.symbol,
          stockName: selectedStock.name,
        }),
        conversationHistory: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        // Include news articles if user is asking for a summary
        ...(newsArticlesToInclude && newsArticlesToInclude.length > 0 && {
          newsArticles: newsArticlesToInclude
        }),
      };


      const response = await sendChatMessage(requestPayload,
        (chunk: string) => {
          // Update the last message with streaming chunks (immutable update)
          setMessages((prev) => {
            const newMessages = [...prev];
            const lastIndex = newMessages.length - 1;
            if (lastIndex >= 0 && newMessages[lastIndex]?.role === "assistant") {
              const currentMessage = newMessages[lastIndex];
              const newContent = (currentMessage.content || '') + chunk;
              
              // Check if this is a news request message from Gemini
              const lowerContent = newContent.toLowerCase();
              
              // More flexible pattern matching for news requests
              const hasNews = lowerContent.includes('news') || lowerContent.includes('headlines');
              const watchlistIndicators = ['watchlist', 'portfolio', 'all stocks', 'all tickers'];
              const tickerIndicators = ['ticker', 'stock', 'symbol'];
              
              const hasWatchlistIndicator = watchlistIndicators.some(ind => lowerContent.includes(ind));
              const hasTickerIndicator = tickerIndicators.some(ind => lowerContent.includes(ind));
              
              const isNewsRequestMessage = hasNews && (hasWatchlistIndicator || hasTickerIndicator);
              
              // If we detect a news request message and haven't triggered for this message yet
              if (isNewsRequestMessage && !newsTriggeredForMessageRef.current.has(lastIndex)) {
                newsTriggeredForMessageRef.current.add(lastIndex);
                
                // Parse the message to determine ticker vs watchlist
                const isWatchlistRequest = hasWatchlistIndicator;
                const isTickerRequest = hasTickerIndicator && !hasWatchlistIndicator;
                
                if (isWatchlistRequest && watchlist && watchlist.length > 0) {
                  // Use all watchlist symbols
                  const symbols = watchlist.map(s => s.symbol);
                  
                  // Trigger news fetch
                  const toolId = `tool-${Date.now()}-${Math.random()}`;
                  setToolExecutions((prev) => {
                    if (prev.find(t => t.id === toolId)) return prev;
                    return [...prev, {
                      id: toolId,
                      type: 'fetch_news',
                      symbol: symbols.join(','),
                      state: 'input-streaming',
                      timestamp: new Date(),
                      messageIndex: lastIndex,
                    }];
                  });
                  
                  fetchNews({ symbols, limit: 10 })
                    .then(articles => {
                      const articleMap = new Map<string, NewsArticle>();
                      articles.forEach(article => {
                        const key = article.id?.toString() || article.url;
                        const existing = articleMap.get(key);
                        if (existing) {
                          const mergedSymbols = [...new Set([...(existing.symbols || []), ...(article.symbols || [])])];
                          articleMap.set(key, { ...existing, symbols: mergedSymbols });
                        } else {
                          articleMap.set(key, {
                            id: article.id,
                            headline: article.headline,
                            summary: article.summary,
                            url: article.url,
                            date: article.created_at,
                            source: article.source,
                            symbols: article.symbols || []
                          });
                        }
                      });
                      const newsArticles = Array.from(articleMap.values());
                      
                      setToolExecutions((prev) => {
                        const toolIndex = prev.findIndex(t => t.id === toolId);
                        if (toolIndex >= 0) {
                          const updated = [...prev];
                          updated[toolIndex] = { ...updated[toolIndex], articles: newsArticles, state: 'output-available' };
                          return updated;
                        }
                        return prev;
                      });
                    })
                    .catch(error => {
                      console.error('Error fetching news:', error);
                      setToolExecutions((prev) => {
                        const toolIndex = prev.findIndex(t => t.id === toolId);
                        if (toolIndex >= 0) {
                          const updated = [...prev];
                          updated[toolIndex] = { ...updated[toolIndex], state: 'output-error' };
                          return updated;
                        }
                        return prev;
                      });
                    });
                } else if (isTickerRequest) {
                  // Extract ticker symbol from message - more flexible pattern matching
                  // Matches patterns like: "news for the ticker AAPL", "news about TSLA", "news on $NVDA"
                  const tickerMatch = newContent.match(/(?:ticker|stock|symbol)[\s:]+\$?([A-Z]{1,5})(?:\s|$|\.|\n)/i) ||
                                      newContent.match(/\$([A-Z]{1,5})(?:\s|$|\.|\n)/) ||
                                      newContent.match(/\b([A-Z]{2,5})\b(?=\s|$|\.|\n)/);
                  if (tickerMatch) {
                    const ticker = tickerMatch[1].toUpperCase();
                    const symbols = [ticker];
                    
                    // Trigger news fetch
                    const toolId = `tool-${Date.now()}-${Math.random()}`;
                    setToolExecutions((prev) => {
                      if (prev.find(t => t.id === toolId)) return prev;
                      return [...prev, {
                        id: toolId,
                        type: 'fetch_news',
                        symbol: ticker,
                        state: 'input-streaming',
                        timestamp: new Date(),
                        messageIndex: lastIndex,
                      }];
                    });
                    
                    fetchNews({ symbols, limit: 10 })
                      .then(articles => {
                        const articleMap = new Map<string, NewsArticle>();
                        articles.forEach(article => {
                          const key = article.id?.toString() || article.url;
                          const existing = articleMap.get(key);
                          if (existing) {
                            const mergedSymbols = [...new Set([...(existing.symbols || []), ...(article.symbols || [])])];
                            articleMap.set(key, { ...existing, symbols: mergedSymbols });
                          } else {
                            articleMap.set(key, {
                              id: article.id,
                              headline: article.headline,
                              summary: article.summary,
                              url: article.url,
                              date: article.created_at,
                              source: article.source,
                              symbols: article.symbols || []
                            });
                          }
                        });
                        const newsArticles = Array.from(articleMap.values());
                        
                        setToolExecutions((prev) => {
                          const toolIndex = prev.findIndex(t => t.id === toolId);
                          if (toolIndex >= 0) {
                            const updated = [...prev];
                            updated[toolIndex] = { ...updated[toolIndex], articles: newsArticles, state: 'output-available' };
                            return updated;
                          }
                          return prev;
                        });
                      })
                      .catch(error => {
                        console.error('Error fetching news:', error);
                        setToolExecutions((prev) => {
                          const toolIndex = prev.findIndex(t => t.id === toolId);
                          if (toolIndex >= 0) {
                            const updated = [...prev];
                            updated[toolIndex] = { ...updated[toolIndex], state: 'output-error' };
                            return updated;
                          }
                          return prev;
                        });
                      });
                  }
                }
              }
              
              // Check if response contains TXL-related content
              const responseText = newContent.toLowerCase();
              const hasTXLContent = responseText.includes('txl.app') || 
                                    responseText.includes('https://txl.app') ||
                                    responseText.includes('created by txl') ||
                                    responseText.includes('screener ai assistant') ||
                                    responseText.includes('screener app');
              
              newMessages[lastIndex] = {
                ...currentMessage,
                content: newContent,
                showSources: isTXLQuery || hasTXLContent || currentMessage.showSources,
              };
            }
            return newMessages;
          });
        },
        (functionCall) => {
          // Handle function calls (e.g., fetch_news) - add to tool executions
          if (functionCall.name === 'fetch_news') {
            console.log('📰 Function call received:', { 
              name: functionCall.name, 
              symbol: functionCall.symbol,
              articlesCount: functionCall.articles?.length,
              hasArticles: !!functionCall.articles
            });
            
            // Get current message index (last assistant message)
            setMessages((currentMessages) => {
              const lastAssistantIndex = currentMessages.length - 1;
              
              // Parse the assistant's message to determine if it's watchlist or ticker
              const assistantMessage = currentMessages[lastAssistantIndex]?.content || '';
              const isWatchlistRequest = assistantMessage.toLowerCase().includes('looking for recent news for the watchlist');
              
              setToolExecutions((prev) => {
                // Find existing tool execution for this call, or create new one
                const existingIndex = prev.findIndex(
                  t => t.type === 'fetch_news' && t.symbol === functionCall.symbol && t.messageIndex === lastAssistantIndex && !t.articles
                );
                
                if (!functionCall.articles) {
                  // Create new tool execution and fetch news from frontend
                  if (existingIndex === -1) {
                    const toolId = `tool-${Date.now()}-${Math.random()}`;
                    
                    // Determine which symbols to fetch
                    let symbols: string[] = [];
                    
                    if (isWatchlistRequest && watchlist && watchlist.length > 0) {
                      // Gemini determined it's a watchlist request - use all watchlist symbols
                      symbols = watchlist.map(s => s.symbol);
                      console.log('📰 Watchlist request detected - using all watchlist symbols:', symbols.length);
                    } else {
                      // Use symbols from function call (either specific ticker or already all watchlist symbols)
                      symbols = functionCall.symbol?.split(',').map(s => s.trim()) || [];
                      console.log('📰 Ticker request or function call symbols:', symbols);
                    }
                    
                    const limit = (functionCall as any).limit || 10;
                    
                    // Fetch news asynchronously
                    fetchNews({ symbols, limit })
                      .then(articles => {
                        // Convert API format to NewsArticle format and deduplicate by ID or URL
                        // Use Map with string key (ID or URL) for proper deduplication
                        const articleMap = new Map<string, NewsArticle>();
                        
                        articles.forEach(article => {
                          // Use article ID as key if available, otherwise use URL
                          const key = article.id?.toString() || article.url;
                          
                          const existing = articleMap.get(key);
                          if (existing) {
                            // Article already exists - merge symbols arrays and deduplicate
                            const mergedSymbols = [...new Set([
                              ...(existing.symbols || []),
                              ...(article.symbols || [])
                            ])];
                            articleMap.set(key, {
                              ...existing,
                              symbols: mergedSymbols
                            });
                          } else {
                            // New article
                            articleMap.set(key, {
                              id: article.id,
                              headline: article.headline,
                              summary: article.summary,
                              url: article.url,
                              date: article.created_at,
                              source: article.source,
                              symbols: article.symbols || []
                            });
                          }
                        });
                        
                        const newsArticles: NewsArticle[] = Array.from(articleMap.values());
                        
                        // Update tool execution with articles
                        setToolExecutions((prevTools) => {
                          const toolIndex = prevTools.findIndex(t => t.id === toolId);
                          if (toolIndex >= 0) {
                            const updated = [...prevTools];
                            updated[toolIndex] = {
                              ...updated[toolIndex],
                              articles: newsArticles,
                              state: 'output-available',
                            };
                            return updated;
                          }
                          return prevTools;
                        });
                      })
                      .catch(error => {
                        console.error('Error fetching news:', error);
                        setToolExecutions((prevTools) => {
                          const toolIndex = prevTools.findIndex(t => t.id === toolId);
                          if (toolIndex >= 0) {
                            const updated = [...prevTools];
                            updated[toolIndex] = {
                              ...updated[toolIndex],
                              state: 'output-error',
                            };
                            return updated;
                          }
                          return prevTools;
                        });
                      });
                    
                    return [...prev, {
                      id: toolId,
                      type: 'fetch_news',
                      symbol: functionCall.symbol,
                      state: 'input-streaming',
                      timestamp: new Date(),
                      messageIndex: lastAssistantIndex,
                    }];
                  }
                  return prev; // Already exists
                } else {
                  // Update existing or create new with articles
                  if (existingIndex >= 0) {
                    const updated = [...prev];
                    updated[existingIndex] = {
                      ...updated[existingIndex],
                      articles: functionCall.articles,
                      state: 'output-available',
                    };
                    return updated;
                  } else {
                    // Create new with articles
                    return [...prev, {
                      id: `tool-${Date.now()}-${Math.random()}`,
                      type: 'fetch_news',
                      symbol: functionCall.symbol,
                      state: 'output-available',
                      articles: functionCall.articles,
                      timestamp: new Date(),
                      messageIndex: lastAssistantIndex,
                    }];
                  }
                }
              });
              
              return currentMessages;
            });
          }
        },
        (metadata) => {
          // Handle metadata (e.g., showSources flag from worker)
          // Also check frontend detection for TXL queries
          const shouldShow = metadata.showSources || isTXLQuery;
          
          if (shouldShow) {
            setMessages((prev) => {
              const newMessages = [...prev];
              const lastIndex = newMessages.length - 1;
              if (lastIndex >= 0 && newMessages[lastIndex]?.role === "assistant") {
                const currentContent = newMessages[lastIndex].content || '';
                const responseText = currentContent.toLowerCase();
                const hasTXLContent = responseText.includes('txl.app') || 
                                      responseText.includes('https://txl.app') ||
                                      responseText.includes('created by txl') ||
                                      responseText.includes('screener ai assistant') ||
                                      responseText.includes('screener app');
                
                // Show sources if it's an identity query OR response contains TXL content
                if (isTXLQuery || hasTXLContent || metadata.showSources) {
                  newMessages[lastIndex] = {
                    ...newMessages[lastIndex],
                    showSources: true,
                  };
                }
              }
              return newMessages;
            });
          }
        }
      );
      
      // For non-streaming responses, update the message with the full response
      // (if it wasn't already updated via streaming chunks)
      if (response) {
        setMessages((prev) => {
          const newMessages = [...prev];
          const lastIndex = newMessages.length - 1;
          if (lastIndex >= 0 && newMessages[lastIndex]?.role === "assistant") {
            const currentMessage = newMessages[lastIndex];
            // Only update if the message is still empty (non-streaming) or if response is longer (complete)
            if (!currentMessage.content || response.length > currentMessage.content.length) {
              newMessages[lastIndex] = {
                ...currentMessage,
                content: response,
              };
            }
          }
          return newMessages;
        });
      }
    } catch (error) {
      // Update the last message with error (immutable update)
      setMessages((prev) => {
        const newMessages = [...prev];
        const lastIndex = newMessages.length - 1;
        if (lastIndex >= 0 && newMessages[lastIndex]?.role === "assistant") {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          
          // Extract error code/type from error message
          let errorCode = "Error";
          const lowerError = errorMessage.toLowerCase();
          
          // Try to extract status code - look for patterns like "(429)", "429", "error 429", etc.
          // First try to match with context (parentheses, colons, etc.), then fallback to any 3 digits
          const statusMatch = errorMessage.match(/(?:\(|^|\s|:)(\d{3})(?:\)|$|\s|:)/) || errorMessage.match(/\b(\d{3})\b/) || errorMessage.match(/(\d{3})/);
          const statusCode = statusMatch ? statusMatch[1] : null;
          
          // Check for rate limit - either explicit mention or status code 429
          if (statusCode === "429" || lowerError.includes("rate limit") || lowerError.includes("quota exceeded")) {
            errorCode = "Error 429: Rate limit exceeded. Try again later.";
          } else if (lowerError.includes("timeout")) {
            errorCode = statusCode ? `Error ${statusCode}: Timeout` : "Error: Timeout. Try again later.";
          } else if (lowerError.includes("network") || lowerError.includes("fetch") || lowerError.includes("failed to fetch")) {
            errorCode = statusCode ? `Error ${statusCode}: Network error` : "Network error";
          } else if (statusCode) {
            // If we have any status code, show it
            errorCode = `Error ${statusCode}`;
          } else if (lowerError.includes("api error") || lowerError.includes("gemini")) {
            errorCode = "API error";
          }
          
          newMessages[lastIndex] = {
            ...newMessages[lastIndex],
            content: "I'm sorry, I couldn't generate a response.", // Set standard error message
            error: errorCode, // Store error code separately
          };
        }
        return newMessages;
      });
    } finally {
      setIsLoading(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleReset = async () => {
    // Always select SPY on reset - find it and update URL with &ticker=SPY
    if (onStockSelect) {
      // Try to find SPY in the current watchlist first (preferred - no URL issues)
      let spyStock = watchlist?.find(stock => stock.symbol === 'SPY');
      
      // If not in current watchlist, check cache (which has all watchlists)
      if (!spyStock) {
        const CACHE_KEY = 'stock-data-cache';
        const CACHE_TIMESTAMP_KEY = 'stock-data-timestamp';
        const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
        
        const cachedData = localStorage.getItem(CACHE_KEY);
        const cacheTimestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
        const now = Date.now();
        
        if (cachedData && cacheTimestamp) {
          const age = now - parseInt(cacheTimestamp);
          if (age < CACHE_DURATION) {
            try {
              const cachedStocksMap = JSON.parse(cachedData) as Record<string, StockTicker[]>;
              // Search through all watchlists in cache
              for (const watchlistId in cachedStocksMap) {
                const stocks = cachedStocksMap[watchlistId];
                const spy = stocks.find(s => s.symbol === 'SPY');
                if (spy) {
                  spyStock = spy;
                  break;
                }
              }
            } catch (err) {
              console.error('Failed to parse cached data for SPY:', err);
            }
          }
        }
      }
      
      // Always select SPY - fetch from API if not found
      if (spyStock) {
        // Found SPY, select it - this will update URL with &ticker=SPY via handleStockSelect
        // Make sure we preserve all fields from the original stock object
        const baseUrl = import.meta.env.VITE_WORKER_URL || '';
        const spyStockWithDefaults: StockTicker = {
          ...spyStock,
          name: spyStock.name || 'SPDR S&P 500 ETF Trust',
          logoUrl: spyStock.logoUrl || `${baseUrl}/api/logos/SPY`,
          // Preserve all other fields
          symbol: spyStock.symbol,
          price: spyStock.price ?? 0,
          change: spyStock.change ?? 0,
          changePercent: spyStock.changePercent ?? 0,
          volume: spyStock.volume ?? 0,
          marketCap: spyStock.marketCap ?? 0,
          priceHistory: spyStock.priceHistory, // Important for chart
          rsi: spyStock.rsi,
          macd: spyStock.macd,
          vwap: spyStock.vwap,
        };
        // This will call handleStockSelect which updates URL with &ticker=SPY
        onStockSelect(spyStockWithDefaults);
      } else {
        // SPY not found in watchlist or cache - fetch from API
        try {
          const spyStocks = await fetchStockData(['SPY']);
          if (spyStocks.length > 0) {
            const baseUrl = import.meta.env.VITE_WORKER_URL || '';
            const fetchedSpyStock: StockTicker = {
              ...spyStocks[0],
              name: spyStocks[0].name || 'SPDR S&P 500 ETF Trust',
              logoUrl: spyStocks[0].logoUrl || `${baseUrl}/api/logos/SPY`,
            };
            // This will call handleStockSelect which updates URL with &ticker=SPY
            onStockSelect(fetchedSpyStock);
          } else {
            // API returned empty - create minimal object as fallback
            const baseUrl = import.meta.env.VITE_WORKER_URL || '';
            const minimalSpyStock: StockTicker = {
              symbol: 'SPY',
              name: 'SPDR S&P 500 ETF Trust',
              price: 0,
              change: 0,
              changePercent: 0,
              volume: 0,
              marketCap: 0,
              logoUrl: `${baseUrl}/api/logos/SPY`,
            };
            onStockSelect(minimalSpyStock);
          }
        } catch (error) {
          // Fallback to minimal object if API fails
          const baseUrl = import.meta.env.VITE_WORKER_URL || '';
          const minimalSpyStock: StockTicker = {
            symbol: 'SPY',
            name: 'SPDR S&P 500 ETF Trust',
            price: 0,
            change: 0,
            changePercent: 0,
            volume: 0,
            marketCap: 0,
            logoUrl: `${baseUrl}/api/logos/SPY`,
          };
          onStockSelect(minimalSpyStock);
        }
      }
    } else if (onStockDeselect) {
      // If no onStockSelect, just deselect
      onStockDeselect();
    }
    
    // Reset chat messages
    if (watchlist && watchlist.length > 0) {
      const displayName = watchlistName || 'this watchlist';
      setMessages([
        {
          role: "assistant",
          content: `Hello! Ask me questions about any stock in ${displayName} (${watchlist.length} stocks). What would you like to know?`,
          timestamp: new Date(),
        },
      ]);
    } else {
      setMessages([]);
    }
    setInputValue("");
    // Clear the news trigger tracking
    newsTriggeredForMessageRef.current.clear();
    // Clear tool executions
    setToolExecutions([]);
  };

  // Helper component to render text with gradient for tickers/watchlist names
  const GradientText = ({ text, tickers, watchlistName }: { text: string; tickers: string[]; watchlistName?: string }) => {
    // If no tickers or watchlist name, return plain text
    if (tickers.length === 0 && !watchlistName) {
      return <>{text}</>;
    }
    
    // Build regex pattern for all tickers and watchlist name
    const patterns: string[] = [];
    tickers.forEach(ticker => {
      patterns.push(`\\$${ticker}\\b|\\b${ticker}\\b`);
    });
    if (watchlistName) {
      patterns.push(`\\b${watchlistName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    }
    
    const combinedRegex = new RegExp(`(${patterns.join('|')})`, 'gi');
    
    // Split text by matches, preserving the matches
    const parts: Array<{ text: string; isGradient: boolean }> = [];
    let lastIndex = 0;
    let match;
    
    // Reset regex lastIndex to ensure we start from the beginning
    combinedRegex.lastIndex = 0;
    
    while ((match = combinedRegex.exec(text)) !== null) {
      // Add text before match
      if (match.index > lastIndex) {
        parts.push({ text: text.substring(lastIndex, match.index), isGradient: false });
      }
      // Add match with gradient
      parts.push({ text: match[0], isGradient: true });
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining text
    if (lastIndex < text.length) {
      parts.push({ text: text.substring(lastIndex), isGradient: false });
    }
    
    // If no matches, return original text
    if (parts.length === 0) {
      return <>{text}</>;
    }
    
    // Join parts with proper spacing - ensure spaces are preserved
    return (
      <span>
        {parts.map((part, i) => 
          part.isGradient ? (
            <span key={i} className="font-bold bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 bg-clip-text text-transparent">
              {part.text}
            </span>
          ) : (
            <span key={i}>{part.text}</span>
          )
        )}
      </span>
    );
  };

  // Helper functions to generate suggestion messages
  const getNewsSuggestion = (): string => {
    if (selectedStock) {
      return `Give me recent news about ${selectedStock.symbol}`;
    } else if (watchlistName) {
      return `Give me recent news about this watchlist (${watchlistName})`;
    } else {
      return "Give me recent news about this watchlist";
    }
  };

  const getCompanyInfoSuggestion = (): string => {
    if (selectedStock) {
      return `Tell me more about what ${selectedStock.symbol} does`;
    } else if (randomTicker) {
      return `Tell me more about what ${randomTicker} does`;
    } else {
      return "Tell me more about what these companies do";
    }
  };

  const getOpportunitiesSuggestion = (): string => {
    return "When should I think about buying more stocks?";
  };

  const handleSuggestionClick = (message: string) => {
    setInputValue(message);
    textareaRef.current?.focus();
  };

  return (
    <div className="flex-1 mt-0 flex flex-col h-full bg-background border rounded-xl overflow-hidden">
      {/* Header */}
      {watchlist && watchlist.length > 0 && (
        <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className={cn(
                "size-2 rounded-full",
                isLoading ? "bg-yellow-500 animate-pulse" : "bg-green-500"
              )} />
              <span className="font-medium text-sm">AI Assistant</span>
            </div>
            <Separator orientation="vertical" className="h-4" />
            <span className="text-muted-foreground text-xs">
              {selectedStock ? selectedStock.symbol : (watchlistName || `${watchlist.length} stocks`)}
            </span>
          </div>
          <Button
          variant="ghost"
            size="sm"
            onClick={handleReset}
            className="h-8 px-2"
          >
            <RotateCcw className="size-4" />
            <span className="ml-1 hidden sm:inline">Reset</span>
          </Button>
        </div>
      )}

      {/* Messages area */}
      <div
        ref={conversationRef}
        className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6"
      >
        {!watchlist || watchlist.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm h-full flex flex-col items-center justify-center">
            <Sparkles className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="font-medium">Chat View</p>
            <p className="text-xs mt-1">No watchlist available</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm h-full flex flex-col items-center justify-center">
            <Sparkles className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="font-medium">Ready to chat</p>
            <p className="text-xs mt-1">
              {selectedStock 
                ? `Ask me anything about ${selectedStock.symbol} or any stock in ${watchlistName || 'this watchlist'}`
                : `Ask me anything about any stock in ${watchlistName || 'this watchlist'} (${watchlist.length} stocks)`
              }
            </p>
          </div>
        ) : (
          <>
            {messages.map((message, index) => {
              // Don't render empty assistant messages (they're being streamed)
              if (message.role === "assistant" && !message.content && isLoading && index === messages.length - 1) {
                return null;
              }
              
              // Find tool executions associated with this message
              const messageToolExecutions = toolExecutions.filter(
                tool => tool.messageIndex === index
              );
              
              return (
                <div key={index} className="space-y-4">
                  <div
                    className={cn(
                      "flex gap-4 items-start",
                      message.role === "user" ? "justify-end" : "justify-start"
                    )}
                  >
                    {message.role === "assistant" && (
                      <img src="/Screener.svg" alt="Screener" className="size-5 flex-shrink-0 mt-2" />
                    )}
                    <div
                      className={cn(
                        "max-w-[80%] rounded-lg px-3 py-2 relative group",
                        message.role === "user"
                          ? "bg-primary text-primary-foreground ml-auto"
                          : "bg-muted text-foreground"
                      )}
                    >
                      {message.role === "assistant" ? (
                        <>
                          {/* Show AI response content */}
                          {message.content ? (
                            <>
                              <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none prose-headings:my-2 prose-p:mt-0 prose-p:mb-2 prose-ul:my-2 prose-ul:ml-4 prose-ol:my-2 prose-ol:ml-4 prose-li:my-0 prose-li:ml-0 prose-strong:font-semibold prose-code:text-xs prose-code:bg-muted/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-muted/50 prose-pre:p-2 prose-pre:rounded-lg prose-pre:overflow-x-auto prose-a:text-primary prose-a:underline prose-a:hover:text-primary/80">
                                <ReactMarkdown
                                  components={{
                                    p: ({ children }) => <p className="mt-0 mb-2 last:mb-0">{children}</p>,
                                    ul: ({ children }) => <ul className="list-disc mb-2 space-y-0.5 ml-4 pl-0">{children}</ul>,
                                    ol: ({ children }) => <ol className="list-decimal mb-2 space-y-0.5 ml-4 pl-0">{children}</ol>,
                                    li: ({ children }) => <li className="leading-relaxed pl-0">{children}</li>,
                                    strong: ({ children }) => {
                                      const text = String(children);
                                      // Check if it's a ticker or watchlist name (starts with $ or matches watchlist name)
                                      const isTicker = text.match(/^\$?[A-Z]{1,5}$/);
                                      const isWatchlistName = watchlistName && text === watchlistName;
                                      
                                      if (isTicker || isWatchlistName) {
                                        return (
                                          <strong className="font-bold bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 bg-clip-text text-transparent">
                                            {children}
                                          </strong>
                                        );
                                      }
                                      return <strong className="font-semibold">{children}</strong>;
                                    },
                                    em: ({ children }) => <em className="italic">{children}</em>,
                                    a: ({ href, children }) => {
                                      // Check if href is a valid URL
                                      const isUrl = href && (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('www.'));
                                      
                                      if (isUrl) {
                                        // Render as clickable pill
                                        const displayUrl = href.replace(/^https?:\/\//, '').replace(/^www\./, '');
                                        return (
                                          <a 
                                            href={href.startsWith('www.') ? `https://${href}` : href}
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-xs font-medium no-underline"
                                          >
                                            <span>{children || displayUrl}</span>
                                            <ExternalLink className="size-3 opacity-60" />
                                          </a>
                                        );
                                      }
                                      
                                      // Regular link for non-URLs
                                      return (
                                        <a 
                                          href={href} 
                                          target="_blank" 
                                          rel="noopener noreferrer"
                                          className="text-primary underline hover:text-primary/80"
                                        >
                                          {children}
                                        </a>
                                      );
                                    },
                                    code: ({ children, className }) => {
                                      const isInline = !className;
                                      if (isInline) {
                                        return <code className="bg-muted/50 px-1 py-0.5 rounded text-xs font-mono">{children}</code>;
                                      }
                                      return <code className={className}>{children}</code>;
                                    },
                                    pre: ({ children }) => <pre className="bg-muted/50 p-2 rounded-lg overflow-x-auto mb-2">{children}</pre>,
                                  }}
                                >
                                  {linkifyUrls(highlightTickersAndWatchlists(message.content))}
                                </ReactMarkdown>
                              </div>
                              <Actions className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Action
                                  tooltip={copiedMessageId === message.timestamp.getTime().toString() ? "Copied!" : "Copy response"}
                                  label="Copy"
                                  onClick={() => {
                                    navigator.clipboard.writeText(message.content);
                                    const messageId = message.timestamp.getTime().toString();
                                    setCopiedMessageId(messageId);
                                    setTimeout(() => {
                                      setCopiedMessageId(null);
                                    }, 2000);
                                  }}
                                  className="size-6 p-0"
                                >
                                  {copiedMessageId === message.timestamp.getTime().toString() ? (
                                    <CheckIcon className="size-3" />
                                  ) : (
                                    <CopyIcon className="size-3" />
                                  )}
                                </Action>
                              </Actions>
                            </>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                              <span className="text-sm text-muted-foreground">Thinking...</span>
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                          {message.content}
                        </p>
                      )}
                    </div>
                    {message.role === "user" && (
                      <div className="flex-shrink-0 size-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <User className="size-4 text-primary" />
                      </div>
                    )}
                  </div>
                  
                  {/* Error message - Show in red after failed messages */}
                  {message.error && (
                    <div className="flex gap-4 justify-start">
                      <div className="flex-shrink-0 size-8" /> {/* Spacer for alignment */}
                      <div className="max-w-[80%]">
                        <p className="text-xs text-red-500 dark:text-red-400 whitespace-pre-wrap break-words leading-relaxed">
                          {message.error}
                        </p>
                      </div>
                    </div>
                  )}
                  
                  {/* Sources - Show when worker indicates sources should be shown */}
                  {message.showSources && (
                    <div className="flex gap-4 justify-start">
                      <div className="flex-shrink-0 size-8" /> {/* Spacer for alignment */}
                      <div className="max-w-[80%]">
                        <Sources defaultOpen={false}>
                          <SourcesTrigger count={1} />
                          <SourcesContent>
                            <Source href="https://txl.app" title="TXL App" />
                          </SourcesContent>
                        </Sources>
                      </div>
                    </div>
                  )}
                  
                  {/* Tool Executions - Inline after assistant message, like reasoning */}
                  {message.role === "assistant" && messageToolExecutions.length > 0 && (
                    <div className="flex gap-4 justify-start">
                      <div className="flex-shrink-0 size-8" /> {/* Spacer for alignment */}
                      <div className="max-w-[80%] space-y-3">
                        {messageToolExecutions.map((tool) => (
                          tool.state === 'input-streaming' ? (
                            <Tool key={tool.id} defaultOpen={true}>
                              <ToolHeader 
                                type="Fetching news articles"
                                state="input-streaming"
                              />
                              <ToolContent>
                                <div className="p-3 flex items-center gap-2 text-sm text-muted-foreground">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  <span>Looking for news...</span>
                                </div>
                              </ToolContent>
                            </Tool>
                          ) : tool.articles && tool.articles.length > 0 ? (
                            <NewsTool
                              key={tool.id}
                              articles={tool.articles}
                              state={tool.state}
                              defaultOpen={false}
                            />
                          ) : (
                            // Show tool execution even when no articles found
                            <Tool key={tool.id} defaultOpen={false}>
                              <ToolHeader 
                                type="Fetching news articles"
                                state="output-available"
                                articleCount={0}
                              />
                              <ToolContent>
                                <ToolOutput
                                  articleCount={0}
                                  output={
                                    <div className="text-sm text-muted-foreground">
                                      No recent news articles found for {tool.symbol || 'this symbol'}.
                                    </div>
                                  }
                                />
                              </ToolContent>
                            </Tool>
                          )
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {isLoading && messages[messages.length - 1]?.role === "assistant" && !messages[messages.length - 1]?.content && (
              <div className="flex gap-4 justify-start items-start">
                <img src="/Screener.svg" alt="Screener" className="size-5 flex-shrink-0 mt-2" />
                <div className="bg-muted rounded-lg px-4 py-3 flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Thinking...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input area */}
      {watchlist && watchlist.length > 0 && (
        <div className="border-t border-border p-4 mb-9 sm:mb-2 bg-background">
          {/* Suggestion Pills - Hide after user sends first message */}
          {messages.filter(m => m.role === 'user').length === 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleSuggestionClick(getNewsSuggestion())}
              disabled={isLoading}
              className="h-7 rounded-full text-xs px-3 py-1 hover:bg-accent"
            >
              <GradientText 
                text={getNewsSuggestion()} 
                tickers={watchlist.map(s => s.symbol)} 
                watchlistName={watchlistName}
              />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleSuggestionClick(getCompanyInfoSuggestion())}
              disabled={isLoading}
              className="h-7 rounded-full text-xs px-3 py-1 hover:bg-accent"
            >
              <GradientText 
                text={getCompanyInfoSuggestion()} 
                tickers={watchlist.map(s => s.symbol)} 
                watchlistName={watchlistName}
              />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleSuggestionClick(getOpportunitiesSuggestion())}
              disabled={isLoading}
              className="h-7 rounded-full text-xs px-3 py-1 hover:bg-accent whitespace-nowrap"
            >
              {getOpportunitiesSuggestion()}
            </Button>
          </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="relative m-0 p-0 block"
            style={{ margin: 0, padding: 0 }}
          >
            <div className="relative rounded-lg focus-within:bg-gradient-to-br focus-within:from-purple-500 focus-within:via-pink-500 focus-within:to-orange-500 focus-within:p-[1px]">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder={selectedStock ? `Ask about ${selectedStock.symbol} or any stock...` : "Ask about any stock in this watchlist..."}
                disabled={isLoading}
                rows={1}
                className={cn(
                  "w-full rounded-lg border border-input bg-background text-sm",
                  "placeholder:text-muted-foreground",
                  "focus:outline-none focus:border-transparent",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  "resize-none",
                  "transition-all",
                  "box-border"
                )}
                style={{ 
                  minHeight: "44px",
                  paddingLeft: "16px",
                  paddingRight: "48px",
                  paddingTop: "12px",
                  paddingBottom: "12px",
                  lineHeight: "20px",
                  margin: 0,
                  display: "block",
                  overflowY: "auto" // Enable scrolling after max lines (maxHeight set dynamically in useEffect)
                }}
              />
            </div>
            <Button
              type="submit"
              disabled={!inputValue.trim() || isLoading}
              size="icon"
              className={cn(
                "absolute right-2 top-1/2 -translate-y-1/2",
                "h-8 w-8 rounded-full m-0",
                "bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500",
                "text-white hover:opacity-90",
                "disabled:opacity-50 disabled:pointer-events-none",
                "transition-all duration-200",
                "shadow-lg shadow-purple-500/50 hover:shadow-xl hover:shadow-purple-500/60",
                "border-0",
                "hover:scale-105 active:scale-95"
              )}
            >
              {isLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
            </Button>
          </form>
          <p className="hidden lg:block text-xs text-muted-foreground mt-2 text-center">
            Press Enter to send, Shift+Enter for new line
          </p>
        </div>
      )}
    </div>
  );
}

