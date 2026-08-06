/**
 * Cloudflare Worker for Stock Screener API
 * 
 * This worker acts as a secure backend proxy for the stock screener app,
 * handling API requests to Alpaca Markets while keeping API keys secure.
 * 
 * Environment Variables:
 * - ALPACA_API_KEY: Your Alpaca API Key ID (set via wrangler secret) - Get free key at https://app.alpaca.markets/signup
 * - ALPACA_API_SECRET: Your Alpaca API Secret Key (set via wrangler secret)
 * - ALLOWED_ORIGINS: Comma-separated list of allowed CORS origins
 * - NOTION_API_KEY: Your Notion Integration API Key (set via wrangler secret)
 * - GEMINI_API_KEY: Your Google Gemini API Key (set via wrangler secret) - Get key at https://makersuite.google.com/app/apikey
 * - LOGO_DEV_PUBLISHABLE_KEY: Your Logo.dev publishable key (set via wrangler secret) - Get key at https://www.logo.dev/dashboard/api-keys
 *   Note: Image CDN requires publishable key (pk_), not secret key (sk_)
 */

import { generateChatSystemInstruction, shouldShowSources } from './chatHelpers';
import { allowChatRequest } from './rateLimit';

interface Env {
  ALPACA_API_KEY: string;
  ALPACA_API_SECRET: string;
  ALLOWED_ORIGINS: string;
  NOTION_API_KEY: string;
  GEMINI_API_KEY: string;
  /** Required for watchlists. Set in wrangler.toml [vars] or via `wrangler secret put`. */
  NOTION_DATABASE_ID: string;
  LOGO_DEV_SECRET_KEY?: string;
  LOGO_DEV_PUBLISHABLE_KEY?: string;
}

function resolveNotionDatabaseId(env: Env): string {
  const id = env.NOTION_DATABASE_ID?.trim();
  if (!id) {
    throw new Error(
      'NOTION_DATABASE_ID is not configured. Set it in wrangler.toml [vars] or as a Worker secret.'
    );
  }
  return id;
}

type SymbolMetadataEntry = { longName?: string; website?: string; allocateAgressive?: number };

const SYMBOL_METADATA_CACHE_TTL = 1000 * 60 * 5;
let symbolMetadataCache: { data: Record<string, SymbolMetadataEntry>; expiresAt: number } | null = null;

interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap: number;
  rsi?: number;
  macd?: number;
  vwap?: number;
  priceHistory?: Array<{ date: string; price: number; vwap?: number }>;
  logoUrl?: string;
}

// CORS headers helper
function corsHeaders(origin: string, allowedOrigins: string, contentType?: string): Headers {
  const origins = (allowedOrigins || '').split(',').map(o => o.trim()).filter(Boolean);
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });

  // Set Content-Type if provided, otherwise default to JSON for API responses
  if (contentType) {
    headers.set('Content-Type', contentType);
  } else {
    headers.set('Content-Type', 'application/json');
  }

  // Allow if explicitly listed, wildcard, or localhost (for development)
  const isLocalhost = origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
  
  if (origins.includes('*') || origins.includes(origin) || isLocalhost) {
    headers.set('Access-Control-Allow-Origin', origin);
    console.log(`✅ CORS allowed for origin: ${origin}`);
  } else {
    console.warn(`⚠️ CORS blocked for origin: ${origin}, allowed: ${origins.join(', ')}`);
  }

  return headers;
}

// Handle OPTIONS request for CORS preflight
function handleOptions(request: Request, env: Env): Response {
  const origin = request.headers.get('Origin') || '';
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin, env.ALLOWED_ORIGINS),
  });
}

// Format Notion database ID (add dashes if needed)
function formatNotionId(id: string): string {
  // If already has dashes, return as-is
  if (id.includes('-')) {
    return id;
  }
  // Format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  if (id.length === 32) {
    return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
  }
  return id;
}

// Fetch all pages from a Notion database with pagination
async function fetchAllNotionPages(databaseId: string, apiKey: string): Promise<any[]> {
  const formattedId = formatNotionId(databaseId);
  const allPages: any[] = [];
  let startCursor: string | undefined = undefined;
  
  while (true) {
    const url = `https://api.notion.com/v1/databases/${formattedId}/query`;
    const body: any = {};
    if (startCursor) {
      body.start_cursor = startCursor;
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Notion API error: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json() as {
      results: any[];
      next_cursor: string | null;
      has_more: boolean;
    };
    
    allPages.push(...data.results);
    
    if (!data.has_more || !data.next_cursor) {
      break;
    }
    
    startCursor = data.next_cursor;
  }
  
  return allPages;
}

// Fetch a single Notion page by ID
async function fetchNotionPage(pageId: string, apiKey: string): Promise<any> {
  const formattedId = formatNotionId(pageId);
  const url = `https://api.notion.com/v1/pages/${formattedId}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Notion API error: ${response.status} - ${errorText}`);
  }
  
  return await response.json();
}

// Fetch all blocks from a Notion page with pagination, including nested children
async function fetchAllNotionBlocks(pageId: string, apiKey: string): Promise<any[]> {
  const formattedId = formatNotionId(pageId);
  const allBlocks: any[] = [];
  let startCursor: string | undefined = undefined;
  
  while (true) {
    const url = `https://api.notion.com/v1/blocks/${formattedId}/children`;
    const params = new URLSearchParams();
    if (startCursor) {
      params.set('start_cursor', startCursor);
    }
    params.set('page_size', '100');
    
    const fullUrl = `${url}?${params.toString()}`;
    
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Notion API error: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json() as {
      results: any[];
      next_cursor: string | null;
      has_more: boolean;
    };
    
    // Log if this is a toggle block's children being fetched
    if (data.results.some((b: any) => b.type === 'toggle') || pageId.includes('toggle') || false) {
      console.log(`📥 Fetching children for block ${pageId.substring(0, 8)}...: got ${data.results.length} results`);
    }
    
    // Fetch children for each block that has children
    for (const block of data.results) {
      // ALWAYS fetch children for toggle blocks - they always have content inside
      if (block.type === 'toggle') {
        try {
          const toggleFormattedId = formatNotionId(block.id);
          const childrenUrl = `https://api.notion.com/v1/blocks/${toggleFormattedId}/children?page_size=100`;
          
          console.log(`🔄 RAW API CALL for toggle ${block.id}:`);
          console.log(`   URL: ${childrenUrl}`);
          console.log(`   Full block object:`, JSON.stringify(block, null, 2));
          
          const childrenResponse = await fetch(childrenUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Notion-Version': '2022-06-28',
              'Content-Type': 'application/json',
            },
          });
          
          console.log(`   Response status: ${childrenResponse.status}`);
          
          if (!childrenResponse.ok) {
            const errorText = await childrenResponse.text();
            console.error(`   ❌ API ERROR: ${childrenResponse.status}`);
            console.error(`   Error body: ${errorText}`);
            throw new Error(`Notion API error: ${childrenResponse.status} - ${errorText}`);
          }
          
          const rawResponse = await childrenResponse.text();
          console.log(`   ✅ RAW API RESPONSE (first 2000 chars):`, rawResponse.substring(0, 2000));
          
          const childrenData = JSON.parse(rawResponse) as {
            results: any[];
            next_cursor: string | null;
            has_more: boolean;
          };
          
          // Store raw response on the block for debugging
          block._raw_toggle_response = rawResponse;
          block._parsed_toggle_response = childrenData;
          
          console.log(`   📦 PARSED RESPONSE:`, {
            results_count: childrenData.results.length,
            has_more: childrenData.has_more,
            next_cursor: childrenData.next_cursor,
            all_results: JSON.stringify(childrenData.results, null, 2)
          });
          
          // Now recursively fetch children of these children
          const children: any[] = [];
          for (const childBlock of childrenData.results) {
            // Recursively fetch children for this child block
            if (childBlock.has_children || childBlock.type === 'toggle') {
              const nestedChildren = await fetchAllNotionBlocks(childBlock.id, apiKey);
              childBlock.children = nestedChildren;
            } else {
              childBlock.children = [];
            }
            children.push(childBlock);
          }
          
          // Handle pagination
          if (childrenData.has_more && childrenData.next_cursor) {
            let cursor: string | null = childrenData.next_cursor;
            while (cursor) {
              const nextUrl = `https://api.notion.com/v1/blocks/${toggleFormattedId}/children?page_size=100&start_cursor=${cursor}`;
              const nextResponse = await fetch(nextUrl, {
                method: 'GET',
                headers: {
                  'Authorization': `Bearer ${apiKey}`,
                  'Notion-Version': '2022-06-28',
                  'Content-Type': 'application/json',
                },
              });
              
              const nextData = await nextResponse.json() as {
                results: any[];
                next_cursor: string | null;
                has_more: boolean;
              };
              
              for (const childBlock of nextData.results) {
                if (childBlock.has_children || childBlock.type === 'toggle') {
                  const nestedChildren = await fetchAllNotionBlocks(childBlock.id, apiKey);
                  childBlock.children = nestedChildren;
                } else {
                  childBlock.children = [];
                }
                children.push(childBlock);
              }
              
              cursor = nextData.next_cursor || null;
            }
          }
          
          block.children = children;
          if (block.toggle) {
            block.toggle.children = children;
          }
          
          console.log(`✅ FINAL: Toggle block ${block.id} has ${children.length} children`);
        } catch (error) {
          console.error(`❌ ERROR fetching children for toggle block ${block.id}:`, error);
          if (error instanceof Error) {
            console.error(`   Error message: ${error.message}`);
            console.error(`   Error stack: ${error.stack}`);
          }
          block.children = [];
          if (block.toggle) {
            block.toggle.children = [];
          }
        }
        continue; // Skip the normal has_children check for toggles
      }
      
      // For other blocks, check has_children property
      const hasChildren = block.has_children === true || 
                         (block[block.type] && block[block.type].has_children === true);
      
      if (hasChildren) {
        try {
          // Special logging for list items
          if (block.type === 'numbered_list_item' || block.type === 'bulleted_list_item') {
            const formattedId = formatNotionId(block.id);
            const childrenUrl = `https://api.notion.com/v1/blocks/${formattedId}/children?page_size=100`;
            console.log(`🔄 Fetching children for ${block.type} ${block.id}:`);
            console.log(`   URL: ${childrenUrl}`);
            
            const rawResponse = await fetch(childrenUrl, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json',
              },
            });
            
            const rawText = await rawResponse.text();
            console.log(`   ✅ RAW API RESPONSE for ${block.type}:`, rawText);
            
            const childrenData = JSON.parse(rawText);
            console.log(`   📦 PARSED: ${childrenData.results?.length || 0} children, types:`, 
              childrenData.results?.map((r: any) => r.type) || []);
            
            // Store raw response
            block._raw_list_item_response = rawText;
            block._parsed_list_item_response = childrenData;
          }
          
          const children = await fetchAllNotionBlocks(block.id, apiKey);
          block.children = children;
          if (block[block.type]) {
            block[block.type].children = children;
          }
        } catch (error) {
          console.warn(`Failed to fetch children for block ${block.id} (type: ${block.type}):`, error);
          block.children = [];
          if (block[block.type]) {
            block[block.type].children = [];
          }
        }
      } else {
        // Ensure children is always an array (even if empty) for consistency
        block.children = [];
        if (block[block.type]) {
          block[block.type].children = [];
        }
      }
    }
    
    allBlocks.push(...data.results);
    
    if (!data.has_more || !data.next_cursor) {
      break;
    }
    
    startCursor = data.next_cursor;
  }
  
  return allBlocks;
}

// Extract property value from Notion page
function extractPropertyValue(page: any, propertyName: string): any {
  const property = page.properties?.[propertyName];
  if (!property) return null;
  
  switch (property.type) {
    case 'title':
      return property.title?.[0]?.plain_text || '';
    case 'rich_text':
      return property.rich_text?.[0]?.plain_text || '';
    case 'select':
      return property.select?.name || null;
    case 'multi_select':
      return property.multi_select?.map((item: any) => item.name) || [];
    case 'relation':
      return property.relation?.map((item: any) => item.id) || [];
    case 'number':
      return property.number;
    case 'checkbox':
      return property.checkbox;
    case 'date':
      return property.date?.start || null;
    case 'url':
      return property.url || null;
    case 'formula':
      // Handle formula results - can be string, number, boolean, date, etc.
      const formulaResult = property.formula;
      if (!formulaResult) return null;
      
      if (formulaResult.type === 'string') {
        return formulaResult.string || null;
      } else if (formulaResult.type === 'number') {
        return formulaResult.number;
      } else if (formulaResult.type === 'boolean') {
        return formulaResult.boolean;
      } else if (formulaResult.type === 'date') {
        return formulaResult.date?.start || null;
      } else if (formulaResult.type === 'rich_text') {
        return formulaResult.rich_text?.[0]?.plain_text || null;
      }
      return null;
    case 'rollup':
      // Handle rollup results - can be string, number, date, array, etc.
      const rollupResult = property.rollup;
      if (!rollupResult) return null;
      
      if (rollupResult.type === 'string') {
        return rollupResult.string || null;
      } else if (rollupResult.type === 'number') {
        return rollupResult.number;
      } else if (rollupResult.type === 'date') {
        return rollupResult.date?.start || null;
      } else if (rollupResult.type === 'array') {
        // For array rollups, return the first item if it's a string/url
        const arrayValue = rollupResult.array?.[0];
        if (arrayValue) {
          if (arrayValue.type === 'url') {
            return arrayValue.url || null;
          } else if (arrayValue.type === 'string') {
            return arrayValue.string || null;
          } else if (arrayValue.type === 'rich_text') {
            return arrayValue.rich_text?.[0]?.plain_text || null;
          } else if (arrayValue.type === 'title') {
            // Handle title type (common in relation rollups)
            return arrayValue.title?.[0]?.plain_text || null;
          } else if (arrayValue.type === 'relation') {
            // Handle relation type - extract the related page's title or name
            // Note: This might require fetching the related page, but for now try to get what's available
            if (arrayValue.relation && Array.isArray(arrayValue.relation) && arrayValue.relation.length > 0) {
              // This is a relation object, we'd need to fetch the page to get its properties
              // For now, return the array so the caller can handle it
              return rollupResult.array || [];
            }
          }
        }
        // Return the full array so caller can process it (for URL objects, etc.)
        return rollupResult.array || [];
      } else if (rollupResult.type === 'url') {
        // Handle direct URL rollup (not in array)
        return rollupResult.url || null;
      }
      return null;
    default:
      return null;
  }
}

// Fetch watchlists from Notion and transform to expected format
async function fetchWatchlistsFromNotion(databaseId: string, apiKey: string): Promise<{
  defaultFavorites: string[];
  defaultSort: {
    column: string;
    direction: string;
  };
  watchlists: Array<{
    id: string;
    name: string;
    symbols: string[];
  }>;
  symbolMetadata?: Record<string, { longName?: string; website?: string; allocateAgressive?: number }>;
}> {
  const pages = await fetchAllNotionPages(databaseId, apiKey);
  
  // Map to store watchlist -> symbols
  const watchlistMap = new Map<string, Set<string>>();
  const watchlistNames = new Map<string, string>();
  // Map to store symbol -> metadata (long name, website, allocateAgressive, etc.)
  const symbolMetadata = new Map<string, SymbolMetadataEntry>();
  
  // Process each page
  for (const page of pages) {
    // Try common property names for symbol/ticker
    const symbol = extractPropertyValue(page, 'Symbol') || 
                   extractPropertyValue(page, 'Ticker') ||
                   extractPropertyValue(page, 'symbol') ||
                   extractPropertyValue(page, 'ticker') ||
                   extractPropertyValue(page, 'Symbol/Ticker');
    
    if (!symbol || typeof symbol !== 'string') {
      continue; // Skip pages without a valid symbol
    }
    
    const symbolUpper = symbol.trim().toUpperCase();
    if (!symbolUpper) continue;
    
    // Extract Long Name from Notion
    const longName = extractPropertyValue(page, 'Long Name') ||
                     extractPropertyValue(page, 'long name') ||
                     extractPropertyValue(page, 'LongName') ||
                     extractPropertyValue(page, 'longName') ||
                     extractPropertyValue(page, 'Company Name') ||
                     extractPropertyValue(page, 'company name');
    
    // Extract Website/URL from Notion
    const website = extractPropertyValue(page, 'URL') ||
                    extractPropertyValue(page, 'url') ||
                    extractPropertyValue(page, 'Website') ||
                    extractPropertyValue(page, 'website') ||
                    extractPropertyValue(page, 'Link') ||
                    extractPropertyValue(page, 'link');
    
    // Extract Allocate Aggressive from Notion
    const allocateAgressive = extractPropertyValue(page, 'Allocate Aggressive') ||
                             extractPropertyValue(page, 'allocate aggressive') ||
                             extractPropertyValue(page, 'AllocateAggressive') ||
                             extractPropertyValue(page, 'allocateAggressive') ||
                             extractPropertyValue(page, 'Allocate Agressive') ||
                             extractPropertyValue(page, 'allocate agressive') ||
                             extractPropertyValue(page, 'AllocateAgressive') ||
                             extractPropertyValue(page, 'allocateAgressive');
    
    // Store metadata for this symbol
    const metadata: { longName?: string; website?: string; allocateAgressive?: number } = {};
    if (longName && typeof longName === 'string') {
      metadata.longName = longName.trim();
    }
    if (website && typeof website === 'string') {
      metadata.website = website.trim();
    }
    if (allocateAgressive !== null && allocateAgressive !== undefined) {
      // Convert to number if it's a string or use directly if it's a number
      const numValue = typeof allocateAgressive === 'number' 
        ? allocateAgressive 
        : parseFloat(String(allocateAgressive));
      if (!isNaN(numValue)) {
        metadata.allocateAgressive = numValue;
      }
    }
    if (Object.keys(metadata).length > 0) {
      symbolMetadata.set(symbolUpper, metadata);
    }
    
    // Try common property names for watchlist
    const watchlists = extractPropertyValue(page, 'Watchlist') ||
                      extractPropertyValue(page, 'watchlist') ||
                      extractPropertyValue(page, 'Watchlists') ||
                      extractPropertyValue(page, 'watchlists') ||
                      extractPropertyValue(page, 'List') ||
                      extractPropertyValue(page, 'list');
    
    // Handle different watchlist formats
    let watchlistIds: string[] = [];
    
    if (Array.isArray(watchlists)) {
      // Multi-select or relation
      watchlistIds = watchlists.map((w: any) => {
        if (typeof w === 'string') {
          return w.toLowerCase().replace(/\s+/g, '-');
        }
        return String(w).toLowerCase().replace(/\s+/g, '-');
      });
    } else if (watchlists) {
      // Single select
      watchlistIds = [String(watchlists).toLowerCase().replace(/\s+/g, '-')];
    } else {
      // Default watchlist if none specified
      watchlistIds = ['default'];
    }
    
    // Add symbol to each watchlist
    for (const watchlistId of watchlistIds) {
      if (!watchlistMap.has(watchlistId)) {
        watchlistMap.set(watchlistId, new Set());
        // Try to get watchlist name from first occurrence
        watchlistNames.set(watchlistId, watchlistId.split('-').map(w => 
          w.charAt(0).toUpperCase() + w.slice(1)
        ).join(' '));
      }
      watchlistMap.get(watchlistId)!.add(symbolUpper);
    }
  }
  
  // Convert to expected format
  const watchlists = Array.from(watchlistMap.entries()).map(([id, symbols]) => ({
    id,
    name: watchlistNames.get(id) || id,
    symbols: Array.from(symbols).sort(),
  }));
  
  // Sort watchlists by id for consistency
  watchlists.sort((a, b) => a.id.localeCompare(b.id));
  
  // Convert metadata map to object
  const metadataObj: Record<string, SymbolMetadataEntry> = {};
  symbolMetadata.forEach((metadata, symbol) => {
    metadataObj[symbol] = metadata;
  });
  
  return {
    defaultFavorites: watchlists.length > 0 ? [watchlists[0].id] : [],
    defaultSort: {
      column: "changePercent",
      direction: "asc"
    },
    watchlists,
    symbolMetadata: metadataObj
  };
}

async function getSymbolMetadata(env: Env): Promise<Record<string, SymbolMetadataEntry>> {
  if (!env.NOTION_API_KEY) {
    return {};
  }

  const now = Date.now();
  if (symbolMetadataCache && symbolMetadataCache.expiresAt > now) {
    return symbolMetadataCache.data;
  }

  const databaseId = resolveNotionDatabaseId(env);
  const watchlistsData = await fetchWatchlistsFromNotion(databaseId, env.NOTION_API_KEY);
  const metadata = watchlistsData.symbolMetadata || {};

  symbolMetadataCache = {
    data: metadata,
    expiresAt: now + SYMBOL_METADATA_CACHE_TTL,
  };

  return metadata;
}

// Clean and normalize a website URL
function cleanWebsiteUrl(url: string): string {
  // Remove leading/trailing whitespace
  let cleaned = url.trim();
  
  // Remove trailing slash
  cleaned = cleaned.replace(/\/$/, '');
  
  return cleaned;
}

function normalizeTickerSymbol(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const match = raw.toUpperCase().match(/[A-Z]{1,5}/);
  return match ? match[0] : null;
}

function extractTickerFromTitle(title: string): string | null {
  if (!title) return null;
  const patterns = [
    /\(([A-Z]{1,5})\)/,
    /\$([A-Z]{1,5})\b/,
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) {
      return normalizeTickerSymbol(match[1]);
    }
  }

  return null;
}

// Extract base domain from a URL
function extractBaseDomain(url: string): string | null {
  try {
    // Clean the URL first
    const cleanedUrl = cleanWebsiteUrl(url);
    
    // Ensure URL has protocol
    const fullUrl = cleanedUrl.startsWith('http') ? cleanedUrl : `https://${cleanedUrl}`;
    const urlObj = new URL(fullUrl);
    let hostname = urlObj.hostname;
    
    // Remove www. prefix if present
    hostname = hostname.replace(/^www\./, '');
    
    return hostname;
  } catch (error) {
    console.warn(`⚠️ Failed to extract domain from URL "${url}":`, error);
    return null;
  }
}

// Fetch logo URL for a symbol using logo.dev ticker endpoint
// According to https://docs.logo.dev/logo-images/ticker - use stock ticker endpoint for best results
// Note: logo.dev image CDN requires a publishable key (pk_), not a secret key (sk_)
async function fetchLogoUrl(symbol: string, _website?: string, logoDevPublishableKey?: string): Promise<string | undefined> {
  if (!logoDevPublishableKey || !symbol) {
    return undefined;
  }

  // Always use ticker endpoint for stock symbols - it's designed for this use case
  // Per logo.dev docs: "Get company logos by stock ticker symbols. Supports NYSE, NASDAQ, and global exchanges."
  console.log(`🔍 Using logo.dev ticker endpoint for ${symbol}`);
  return `https://img.logo.dev/ticker/${symbol.toUpperCase()}?token=${logoDevPublishableKey}`;
}

// Fetch Yahoo Finance data for market cap and volume
// Uses the chart API endpoint which is more reliable: /v8/finance/chart/{symbol}
// This endpoint provides real-time data including price, volume, and metadata
async function fetchYahooFinanceData(symbol: string): Promise<{
  companyName?: string;
  marketCap?: number;
  volume?: number;
}> {
  try {
    // Yahoo Finance Chart API - more reliable endpoint
    // Provides: regularMarketPrice, regularMarketVolume, longName, and other metadata
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}`;
    
    console.log(`📡 Fetching Yahoo Finance chart data for ${symbol}...`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.warn(`⚠️ Yahoo Finance Chart API returned ${response.status} for ${symbol}: ${errorText.substring(0, 200)}`);
      return {};
    }
    
    const data = await response.json() as {
      chart?: {
        result?: Array<{
          meta?: {
            longName?: string;
            shortName?: string;
            regularMarketPrice?: number;
            regularMarketVolume?: number;
            marketCap?: number;
            [key: string]: unknown;
          };
          [key: string]: unknown;
        }>;
        error?: unknown;
      };
    };
    
    // Check for Yahoo Finance API errors
    if (data.chart?.error) {
      console.warn(`⚠️ Yahoo Finance Chart API error for ${symbol}:`, data.chart.error);
      return {};
    }
    
    const result = data.chart?.result?.[0];
    if (!result || !result.meta) {
      console.warn(`⚠️ No data in Yahoo Finance chart response for ${symbol}`);
      return {};
    }
    
    const meta = result.meta;
    
    // Extract data from chart API metadata
    // Chart API provides: longName, regularMarketVolume, and sometimes marketCap
    const companyName = meta.longName;
    const volume = meta.regularMarketVolume;
    // Market cap might not be in chart API, but we can try to get it from quoteSummary as fallback
    let marketCap: number | undefined = meta.marketCap;
    
    // If market cap not in chart API, try quoteSummary as fallback
    if (!marketCap) {
      try {
        const quoteUrl = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=price,summaryDetail`;
        const quoteResponse = await fetch(quoteUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
          },
        });
        
        if (quoteResponse.ok) {
          const quoteData = await quoteResponse.json() as {
            quoteSummary?: {
              result?: Array<{
                price?: {
                  marketCap?: { raw?: number };
                };
                summaryDetail?: {
                  marketCap?: { raw?: number };
                };
              }>;
            };
          };
          
          const quoteResult = quoteData.quoteSummary?.result?.[0];
          marketCap = quoteResult?.price?.marketCap?.raw || quoteResult?.summaryDetail?.marketCap?.raw;
        }
      } catch (quoteError) {
        // Silently fail - we'll just use volume from chart API
        console.warn(`⚠️ Failed to fetch market cap from quoteSummary for ${symbol}`);
      }
    }
    
    if (companyName || marketCap || volume) {
      console.log(`✅ Yahoo Finance chart data for ${symbol}:`, {
        companyName: companyName || 'N/A',
        marketCap: marketCap ? `${(marketCap / 1e9).toFixed(2)}B` : 'N/A',
        volume: volume ? `${(volume / 1e6).toFixed(2)}M` : 'N/A',
      });
    } else {
      console.warn(`⚠️ No useful data extracted from Yahoo Finance chart for ${symbol}`);
    }
    
    return {
      companyName,
      marketCap,
      volume,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`❌ Failed to fetch Yahoo Finance chart data for ${symbol}:`, errorMessage);
    return {};
  }
}

// Fetch stock data from Alpaca Markets API (Free Tier - Basic Plan)
// Basic plan: 200 calls/minute, real-time IEX data, no daily limit
async function fetchStockData(symbols: string[], apiKey: string, apiSecret: string, includeHistory: boolean = false, workerOrigin?: string): Promise<StockQuote[]> {
  try {
    const baseUrl = 'https://data.alpaca.markets';
    
    // Alpaca Markets headers
    const headers = {
      'APCA-API-KEY-ID': apiKey,
      'APCA-API-SECRET-KEY': apiSecret,
    };
    
    // Alpaca Basic (free) tier: 200 calls/minute - we can process in parallel!
    // Calculate date ranges
    // Need at least 26 trading days for MACD, so request ~40 calendar days
    const now = new Date();
    const fortyDaysAgo = new Date(now);
    fortyDaysAgo.setDate(now.getDate() - 40);
    
    const endDate = now.toISOString().split('T')[0];
    const startDate = fortyDaysAgo.toISOString().split('T')[0];
    
    // Process all symbols in parallel for speed
    const stockPromises = symbols.map(async (symbol) => {
      try {
        // Fetch company name and market cap from Alpaca's StockSummary API (via Polygon)
        // This provides company information including the name and market cap
        let companyName: string | undefined = undefined;
        let realMarketCap: number | undefined = undefined;
        try {
          // Try StockSummary endpoint first (v1beta1/stocks/{symbol}/summary)
          const summaryUrl = `${baseUrl}/v1beta1/stocks/${symbol}/summary`;
          const summaryResponse = await fetch(summaryUrl, { headers });
          
          if (summaryResponse.ok) {
            const summaryData = await summaryResponse.json() as { 
              name?: string;
              market_cap?: number;
              marketCap?: number;
              // StockSummary API response structure
              [key: string]: unknown;
            };
            
            // Log full response for debugging
            console.log(`StockSummary response for ${symbol}:`, JSON.stringify(summaryData));
            
            if (summaryData.name) {
              companyName = summaryData.name.trim();
              console.log(`✅ Fetched company name from StockSummary for ${symbol}: ${companyName}`);
            } else {
              console.warn(`⚠️ StockSummary response for ${symbol} has no name field`);
            }
            
            // Extract real market cap from API
            if (summaryData.market_cap) {
              realMarketCap = summaryData.market_cap;
              console.log(`✅ Fetched real market cap from StockSummary for ${symbol}: ${realMarketCap}`);
            } else if (summaryData.marketCap) {
              realMarketCap = summaryData.marketCap;
              console.log(`✅ Fetched real market cap from StockSummary for ${symbol}: ${realMarketCap}`);
            }
          } else {
            const errorText = await summaryResponse.text();
            console.warn(`⚠️ StockSummary API returned ${summaryResponse.status} for ${symbol}: ${errorText}`);
          }
          
          // Fallback to Assets API if StockSummary doesn't have name
          if (!companyName) {
            const assetUrl = `https://api.alpaca.markets/v2/assets/${symbol}`;
            const assetResponse = await fetch(assetUrl, { headers });
            if (assetResponse.ok) {
              const assetData = await assetResponse.json() as { 
                name?: string;
                [key: string]: unknown;
              };
              
              console.log(`Assets API response for ${symbol}:`, JSON.stringify(assetData));
              
              if (assetData.name) {
                companyName = assetData.name
                  .replace(/\s+Common Stock\.?$/i, '')
                  .replace(/\s+Class [A-Z]\.?$/i, '')
                  .trim();
                console.log(`✅ Fetched company name from Assets API for ${symbol}: ${companyName}`);
              } else {
                console.warn(`⚠️ Assets API response for ${symbol} has no name field`);
              }
            } else {
              const errorText = await assetResponse.text();
              console.warn(`⚠️ Assets API returned ${assetResponse.status} for ${symbol}: ${errorText}`);
            }
          }
          
          // Company name will come from Notion metadata (Long Name field)
          // Logo will be fetched via logo.dev using the /api/logos/ endpoint
        } catch (error) {
          // All APIs failed, will use fallback
          console.warn(`Failed to fetch company name for ${symbol}:`, error);
        }
        
        // Fetch bars (historical OHLCV data) - includes everything we need
        // Using 1Day timeframe to get daily bars
        // Need at least 26 days for MACD calculation
        // adjustment=all ensures prices are adjusted for stock splits and dividends
        const barsUrl = `${baseUrl}/v2/stocks/${symbol}/bars?timeframe=1Day&start=${startDate}&end=${endDate}&limit=50&feed=iex&adjustment=all`;
        const barsResponse = await fetch(barsUrl, { headers });
        
        if (!barsResponse.ok) {
          console.error(`Failed to fetch bars for ${symbol}: ${barsResponse.status}`);
          return null;
        }
        
        const barsData = await barsResponse.json() as { 
          bars?: Array<{ t: string; o: number; h: number; l: number; c: number; v: number; vw?: number }>;
          [key: string]: unknown;
        };
        
        if (!barsData.bars || barsData.bars.length === 0) {
          console.error(`No bars data for ${symbol}`);
          return null;
        }
        
        const bars = barsData.bars;
        const latestBar = bars[bars.length - 1];
        const previousBar = bars.length > 1 ? bars[bars.length - 2] : latestBar;
        
        // Current price and changes
        const currentPrice = latestBar.c; // close price
        const previousClose = previousBar.c;
        const change = currentPrice - previousClose;
        const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;
        const volume = latestBar.v; // volume
        
        // Extract closing prices for technical indicators
        const closingPrices = bars.map((bar: any) => bar.c);
        
        // Fetch RSI from Alpaca's Technical Indicators API
        // Using 1Day timeframe with 14-period length (standard RSI settings)
        let rsiValue: number | undefined = undefined;
        try {
          // Request RSI data with date range to get recent values
          const rsiUrl = `${baseUrl}/v1beta1/indicators/rsi?symbol=${symbol}&timeframe=1Day&period=14&start=${startDate}&end=${endDate}`;
          const rsiResponse = await fetch(rsiUrl, { headers });
          
          if (rsiResponse.ok) {
            const rsiData = await rsiResponse.json() as {
              rsi?: Array<{ value?: number; [key: string]: unknown }>;
              [key: string]: unknown;
            };
            
            // Get the most recent RSI value
            if (rsiData.rsi && Array.isArray(rsiData.rsi) && rsiData.rsi.length > 0) {
              const latestRsi = rsiData.rsi[rsiData.rsi.length - 1];
              rsiValue = latestRsi.value ? Math.round(latestRsi.value * 100) / 100 : undefined;
            } else {
              rsiValue = calculateRSI(closingPrices, 14);
            }
          } else {
            const errorText = await rsiResponse.text();
            console.warn(`Failed to fetch RSI for ${symbol} (status ${rsiResponse.status}): ${errorText}`);
            rsiValue = calculateRSI(closingPrices, 14);
          }
        } catch (rsiError) {
          console.warn(`Error fetching RSI for ${symbol}:`, rsiError);
          rsiValue = calculateRSI(closingPrices, 14);
        }
        
        // Fetch MACD from Alpaca's Technical Indicators API
        // Using standard parameters: fast=12, slow=26, signal=9
        let macdValue: number | undefined = undefined;
        try {
          const macdUrl = `${baseUrl}/v1beta1/indicators/macd?symbol=${symbol}&timeframe=1Day&fast_period=12&slow_period=26&signal_period=9&start=${startDate}&end=${endDate}`;
          const macdResponse = await fetch(macdUrl, { headers });
          
          if (macdResponse.ok) {
            const macdData = await macdResponse.json() as {
              macd?: Array<{ histogram?: number; [key: string]: unknown }>;
              [key: string]: unknown;
            };
            
            // Get the most recent MACD value (histogram = MACD - Signal)
            if (macdData.macd && Array.isArray(macdData.macd) && macdData.macd.length > 0) {
              const latestMacd = macdData.macd[macdData.macd.length - 1];
              // Use the histogram value (macd_line - signal_line)
              macdValue = latestMacd.histogram ? Math.round(latestMacd.histogram * 100) / 100 : undefined;
            } else {
              macdValue = calculateMACD(closingPrices);
            }
          } else {
            const errorText = await macdResponse.text();
            console.warn(`Failed to fetch MACD for ${symbol} (status ${macdResponse.status}): ${errorText}`);
            macdValue = calculateMACD(closingPrices);
          }
        } catch (macdError) {
          console.warn(`Error fetching MACD for ${symbol}:`, macdError);
          macdValue = calculateMACD(closingPrices);
        }
        
        // Calculate VWAP from today's bars (or use from Alpaca if available)
        const vwapValue = bars[bars.length - 1].vw || calculateVWAP(bars.slice(-10)); // Last 10 days VWAP
        
        // Get price history if requested
        let priceHistory: Array<{ date: string; price: number; vwap?: number }> | undefined = undefined;
        if (includeHistory) {
          priceHistory = bars.map((bar: any) => ({
            date: bar.t.split('T')[0], // Extract date from timestamp
            price: bar.c,
            vwap: bar.vw || undefined // Include VWAP from Alpaca
          }));
        }
        
        // Use company name from APIs if available, otherwise fallback to symbol
        // Note: Long Name from Notion will be used in the frontend via symbolMetadata
        let name = companyName || symbol;
        
        // Fetch Yahoo Finance data for better market cap and volume
        // Wrap in try-catch to prevent Yahoo Finance failures from breaking the whole request
        let yahooData: { companyName?: string; marketCap?: number; volume?: number } = {};
        try {
          yahooData = await fetchYahooFinanceData(symbol);
        } catch (yahooError) {
          console.warn(`Yahoo Finance fetch failed for ${symbol}, continuing without it:`, yahooError);
          // Continue without Yahoo Finance data - use Alpaca data instead
        }
        
        // Use Yahoo Finance longName if available (more reliable than Alpaca)
        if (yahooData.companyName) {
          name = yahooData.companyName;
          console.log(`✅ Using Yahoo Finance longName for ${symbol}: ${name}`);
        }
        
        // Use ONLY real market cap from APIs - no estimates
        // Priority: Yahoo Finance > Alpaca StockSummary > undefined (will show as 0 or —)
        const finalMarketCap = yahooData.marketCap !== undefined 
          ? yahooData.marketCap 
          : (realMarketCap !== undefined ? realMarketCap : 0);
        const finalVolume = yahooData.volume !== undefined ? yahooData.volume : volume;
        
        // Fetch logo URL using logo.dev (supports both ticker and domain lookups)
        // Note: Logo will be fetched separately via /api/logos/ endpoint with website parameter
        const logoUrl = undefined;
        
        const quote: StockQuote = {
          symbol: symbol,
          name: name,
          price: currentPrice,
          change: change,
          changePercent: changePercent,
          volume: finalVolume,
          marketCap: finalMarketCap,
          rsi: rsiValue,
          macd: macdValue,
          vwap: vwapValue,
          priceHistory: priceHistory,
          logoUrl: logoUrl,
        };
        
        return quote;
        
      } catch (err) {
        console.error(`Error fetching ${symbol}:`, err);
        return null;
      }
    });
    
    // Wait for all stocks to be fetched in parallel
    const fetchedStocks = await Promise.all(stockPromises);
    
    // Filter out any null results (failed fetches)
    const results = fetchedStocks.filter((stock): stock is StockQuote => stock !== null);
    
    return results;
  } catch (error) {
    console.error('Error fetching stock data:', error);
    throw error;
  }
}

// Calculate VWAP (Volume Weighted Average Price)
function calculateVWAP(bars: any[]): number {
  let totalPV = 0;
  let totalVolume = 0;
  
  for (const bar of bars) {
    const typicalPrice = (bar.h + bar.l + bar.c) / 3; // (High + Low + Close) / 3
    const volume = bar.v;
    totalPV += typicalPrice * volume;
    totalVolume += volume;
  }
  
  return totalVolume > 0 ? totalPV / totalVolume : 0;
}


// Calculate RSI manually using Wilder's smoothing method (14-period)
// This is the standard RSI calculation used by most platforms
function calculateRSI(prices: number[], period: number = 14): number | undefined {
  if (prices.length < period + 1) return undefined;
  
  // Calculate initial average gain/loss for the first period
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i <= period; i++) {
    const difference = prices[i] - prices[i - 1];
    if (difference > 0) {
      gains += difference;
    } else {
      losses += Math.abs(difference);
    }
  }
  
  let avgGain = gains / period;
  let avgLoss = losses / period;
  
  // Apply Wilder's smoothing for remaining periods
  for (let i = period + 1; i < prices.length; i++) {
    const difference = prices[i] - prices[i - 1];
    const gain = difference > 0 ? difference : 0;
    const loss = difference < 0 ? Math.abs(difference) : 0;
    
    // Wilder's smoothing: (previous avg * (period-1) + current) / period
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;
  
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  
  return Math.round(rsi * 100) / 100;
}

// Calculate MACD manually (simplified) - MACD = EMA12 - EMA26
function calculateMACD(prices: number[]): number | undefined {
  if (prices.length < 26) return undefined;
  
  // Use all available prices for each EMA calculation
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  
  if (ema12 === undefined || ema26 === undefined) return undefined;
  
  const macd = ema12 - ema26;
  return Math.round(macd * 100) / 100;
}

// Calculate EMA
function calculateEMA(prices: number[], period: number): number | undefined {
  if (prices.length < period) return undefined;
  
  const k = 2 / (period + 1);
  let ema = prices[0];
  
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  
  return ema;
}

// Transform Alpha Vantage data to our format
function transformAlphaVantageData(
  quoteData: any, 
  overviewData: any, 
  symbol: string,
  rsiValue?: number,
  macdValue?: number,
  priceHistory?: Array<{ date: string; price: number }>
): StockQuote | null {
  try {
    const globalQuote = quoteData['Global Quote'];
    if (!globalQuote) {
      console.error(`No quote data for ${symbol}`);
      return null;
    }
    
    const currentPrice = parseFloat(globalQuote['05. price']) || 0;
    const change = parseFloat(globalQuote['09. change']) || 0;
    const changePercent = parseFloat(globalQuote['10. change percent']?.replace('%', '')) || 0;
    const volume = parseInt(globalQuote['06. volume']) || 0;
    
    return {
      symbol: symbol,
      name: overviewData.Name || `${symbol} Inc.`,
      price: currentPrice,
      change: change,
      changePercent: changePercent,
      volume: volume,
      marketCap: parseFloat(overviewData.MarketCapitalization) || 0,
      rsi: rsiValue,
      macd: macdValue,
      priceHistory: priceHistory,
    };
  } catch (err) {
    console.error(`Error transforming data for ${symbol}:`, err);
    return null;
  }
}

// Transform API response to our format (legacy function - not currently used)
// The actual implementation uses Alpaca API directly in fetchStockData()
function transformMassiveData(data: any, requestedSymbols: string[]): StockQuote[] {
  // Generic API response transformation
  
  const results: StockQuote[] = [];
  
  // Handle different possible response structures
  if (data.results && Array.isArray(data.results)) {
    // Response has results array
    results.push(...data.results.map((ticker: any) => transformTicker(ticker)));
  } else if (data.ticker) {
    // Single ticker response
    results.push(transformTicker(data.ticker));
  } else if (data.tickers && Array.isArray(data.tickers)) {
    // Tickers array
    results.push(...data.tickers.map((ticker: any) => transformTicker(ticker)));
  }
  
  return results;
}

// Transform individual ticker data from API format
function transformTicker(ticker: any): StockQuote {
  // Extract values from API ticker structure
  const lastQuote = ticker.lastQuote || ticker.quote || {};
  const prevClose = ticker.prevDay?.c || ticker.previousClose || lastQuote.p || 0;
  const currentPrice = lastQuote.p || ticker.price || ticker.lastTrade?.p || prevClose;
  const change = currentPrice - prevClose;
  const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
  
  return {
    symbol: ticker.ticker || ticker.symbol || '',
    name: ticker.name || `${ticker.ticker} Inc.`,
    price: currentPrice,
    change: change,
    changePercent: changePercent,
    volume: ticker.volume || lastQuote.s || ticker.day?.v || 0,
    marketCap: ticker.market_cap || ticker.marketCap || 0,
    rsi: ticker.rsi || undefined,
    macd: ticker.macd || undefined,
  };
}

// Main request handler
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestUrl = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions(request, env);
    }

    try {
      // Debug: Log all requests
      console.log(`🔍 Request: ${request.method} ${requestUrl.pathname}`);
      
      // Route: Get stock data
      if (requestUrl.pathname === '/api/stocks' && request.method === 'GET') {
        console.log(`🌐 Origin: ${origin}, ALLOWED_ORIGINS: ${env.ALLOWED_ORIGINS}`);
        const symbolsParam = requestUrl.searchParams.get('symbols');
        
        if (!symbolsParam) {
          return new Response(
            JSON.stringify({ error: 'Missing symbols parameter' }),
            { 
              status: 400, 
              headers: corsHeaders(origin, env.ALLOWED_ORIGINS) 
            }
          );
        }

        const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).sort();
        const includeHistory = requestUrl.searchParams.get('includeHistory') === 'true';
        
        // Create cache key based on symbols and includeHistory
        // Use a normalized URL for consistent caching
        const cacheKey = `stocks:${symbols.join(',')}:${includeHistory}`;
        const cacheRequest = new Request(`https://cache.internal/${cacheKey}`, {
          method: 'GET',
        });
        
        // Try to get from cache first (1 hour TTL) with retry logic
        const cache = caches.default;
        let cachedResponse: Response | undefined;
        const cacheRetries = 3;
        for (let cacheAttempt = 0; cacheAttempt < cacheRetries; cacheAttempt++) {
          try {
            cachedResponse = await cache.match(cacheRequest);
            if (cachedResponse) {
              break; // Success, exit retry loop
            }
          } catch (error) {
            if (cacheAttempt < cacheRetries - 1) {
              const delay = 50 * (cacheAttempt + 1); // 50ms, 100ms, 150ms
              console.warn(`⚠️ Cache match attempt ${cacheAttempt + 1} failed, retrying after ${delay}ms:`, error);
              await new Promise(resolve => setTimeout(resolve, delay));
            } else {
              console.warn('⚠️ Cache match failed after retries:', error);
            }
          }
        }
        
        if (cachedResponse) {
          console.log(`💾 Cache HIT for symbols: ${symbols.join(', ')}`);
          try {
            const cachedData = await cachedResponse.json();
            return new Response(
              JSON.stringify(cachedData),
              {
                status: 200,
                headers: corsHeaders(origin, env.ALLOWED_ORIGINS),
              }
            );
          } catch (error) {
            console.warn('⚠️ Failed to parse cached response, fetching fresh data:', error);
            // Fall through to fetch fresh data
          }
        }
        
        console.log(`📊 Cache MISS - Fetching stock data for symbols: ${symbols.join(', ')}`);
        
        let stockData: StockQuote[];
        try {
          stockData = await fetchStockData(symbols, env.ALPACA_API_KEY, env.ALPACA_API_SECRET, includeHistory, requestUrl.origin);
        } catch (error) {
          console.error('❌ Error in fetchStockData:', error);
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: error instanceof Error ? error.message : 'Failed to fetch stock data',
              data: [] 
            }),
            {
              status: 500,
              headers: corsHeaders(origin, env.ALLOWED_ORIGINS),
            }
          );
        }

        console.log(`✅ Successfully fetched ${stockData.length} stocks`);
        
        const responseData = { success: true, data: stockData };
        const corsHeadersObj = corsHeaders(origin, env.ALLOWED_ORIGINS);
        corsHeadersObj.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
        const response = new Response(
          JSON.stringify(responseData),
          {
            status: 200,
            headers: corsHeadersObj,
          }
        );
        
        // Cache the response for 1 hour (reduces API calls while keeping data reasonably fresh)
        // Store in cache with retry logic (non-blocking - don't await to avoid blocking response)
        (async () => {
          const cachePutRetries = 3;
          for (let putAttempt = 0; putAttempt < cachePutRetries; putAttempt++) {
            try {
              await cache.put(cacheRequest, response.clone());
              console.log(`✅ Successfully cached response for symbols: ${symbols.join(', ')}`);
              break; // Success, exit retry loop
            } catch (err) {
              if (putAttempt < cachePutRetries - 1) {
                const delay = 100 * (putAttempt + 1); // 100ms, 200ms, 300ms
                console.warn(`⚠️ Cache put attempt ${putAttempt + 1} failed, retrying after ${delay}ms:`, err);
                await new Promise(resolve => setTimeout(resolve, delay));
              } else {
                console.warn('⚠️ Failed to cache response after retries:', err);
              }
            }
          }
        })().catch(err => {
          console.warn('⚠️ Cache put operation failed:', err);
        });
        
        return response;
      }

      // Route: Get watchlists configuration from Notion
      if (requestUrl.pathname === '/api/watchlists' && request.method === 'GET') {
        try {
          const databaseId = resolveNotionDatabaseId(env);

          console.log(`📊 Fetching watchlists from Notion database: ${databaseId}`);
          
          // Fetch all pages from the Notion database
          const watchlistsData = await fetchWatchlistsFromNotion(databaseId, env.NOTION_API_KEY);
          
          console.log(`✅ Fetched ${watchlistsData.watchlists.length} watchlists from Notion`);
          console.log(`📊 SymbolMetadata keys:`, Object.keys(watchlistsData.symbolMetadata || {}));
          console.log(`📊 SymbolMetadata with allocateAgressive:`, 
            Object.entries(watchlistsData.symbolMetadata || {}).filter(([_, meta]) => meta.allocateAgressive !== undefined)
          );
          
          return new Response(
            JSON.stringify(watchlistsData),
            {
              status: 200,
              headers: corsHeaders(origin, env.ALLOWED_ORIGINS),
            }
          );
        } catch (error) {
          console.error('Error fetching watchlists from Notion:', error);
          return new Response(
            JSON.stringify({ 
              error: 'Failed to fetch watchlists from Notion',
              message: error instanceof Error ? error.message : 'Unknown error'
            }),
            { 
              status: 500, 
              headers: corsHeaders(origin, env.ALLOWED_ORIGINS) 
            }
          );
        }
      }

      // Route: Get table configuration
      if (requestUrl.pathname === '/api/config' && request.method === 'GET') {
        const config = {
          defaultSort: {
            column: "rsi",
            direction: "asc"
          },
          defaultColorRules: {
            rsi: [
              { operator: "<", value: 30.00, color: "#ef4444" },
              { operator: ">", value: 70.00, color: "#22c55e" }
            ],
            macd: [
              { operator: ">", value: 0, color: "#22c55e" },
              { operator: "<", value: 0, color: "#ef4444" }
            ],
            changePercent: [
              { operator: ">", value: 0, color: "#22c55e" },
              { operator: "<", value: 0, color: "#ef4444" }
            ],
            change: [
              { operator: ">", value: 0, color: "#22c55e" },
              { operator: "<", value: 0, color: "#ef4444" }
            ],
            vwap: [
              { operator: "vwap_below_price", color: "#22c55e" },
              { operator: "vwap_above_price", color: "#ef4444" }
            ]
          }
        };

        return new Response(
          JSON.stringify(config),
          {
            status: 200,
            headers: corsHeaders(origin, env.ALLOWED_ORIGINS),
          }
        );
      }

      // Route: Get company logo (proxies logo.dev image)
      if (requestUrl.pathname.startsWith('/api/logos/') && request.method === 'GET') {
        const symbol = requestUrl.pathname.split('/api/logos/')[1]?.toUpperCase();
        
        if (!symbol) {
          return new Response(
            JSON.stringify({ error: 'Missing symbol parameter' }),
            { 
              status: 400, 
              headers: corsHeaders(origin, env.ALLOWED_ORIGINS, 'application/json') 
            }
          );
        }

        try {
          // Get optional website parameter from query string
          const website = requestUrl.searchParams.get('website') || undefined;
          
          console.log(`🖼️ Fetching logo for symbol: ${symbol}, website: ${website}`);
          
          // Use logo.dev to get logo URL (requires publishable key for image CDN)
          const logoUrl = await fetchLogoUrl(symbol, website, env.LOGO_DEV_PUBLISHABLE_KEY);
          
          console.log(`🖼️ Logo URL result: ${logoUrl || 'not found'}`);
          
          if (!logoUrl) {
            console.warn(`⚠️ Logo not found for ${symbol} with website: ${website}`);
            return new Response(
              JSON.stringify({ error: 'Logo not found' }),
              { 
                status: 404, 
                headers: corsHeaders(origin, env.ALLOWED_ORIGINS, 'application/json') 
              }
            );
          }

          // If logoUrl is already a logo.dev URL, proxy it
          // Fetch the image from logo.dev and return it
          console.log(`🖼️ Proxying image from: ${logoUrl}`);
          
          try {
            const timeoutPromise = new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error('Timeout')), 5000);
            });
            
            // Add Referer header for domain-restricted API keys
            const logoResponse = await Promise.race([
              fetch(logoUrl, {
                headers: { 'Referer': origin || new URL(request.url).origin }

              }),
              timeoutPromise
            ]) as Response;
            
            if (!logoResponse.ok) {
              console.warn(`⚠️ Failed to fetch logo from ${logoUrl}: ${logoResponse.status} ${logoResponse.statusText}`);
              return new Response(
                JSON.stringify({ error: 'Logo not found' }),
                { 
                  status: 404, 
                  headers: corsHeaders(origin, env.ALLOWED_ORIGINS, 'application/json') 
                }
              );
            }
            
            // Get the image data
            const imageData = await logoResponse.arrayBuffer();
            const contentType = logoResponse.headers.get('content-type') || 'image/png';
            
            // Return the image with appropriate headers
            const responseHeaders = corsHeaders(origin, env.ALLOWED_ORIGINS, contentType);
            responseHeaders.set('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
            
            return new Response(imageData, {
              status: 200,
              headers: responseHeaders,
            });
          } catch (fetchError) {
            console.error(`⚠️ Error fetching logo from ${logoUrl}:`, fetchError instanceof Error ? fetchError.message : String(fetchError));
            return new Response(
              JSON.stringify({ error: 'Failed to fetch logo' }),
              { 
                status: 500, 
                headers: corsHeaders(origin, env.ALLOWED_ORIGINS, 'application/json') 
              }
            );
          }
        } catch (error) {
          console.error(`Error fetching logo for ${symbol}:`, error);
          return new Response(
            JSON.stringify({ error: 'Failed to fetch logo' }),
            { 
              status: 500, 
              headers: corsHeaders(origin, env.ALLOWED_ORIGINS, 'application/json') 
            }
          );
        }
      }

      // Route: Chat with Gemini AI
      if (requestUrl.pathname === '/api/chat' && request.method === 'POST') {
        console.log('📨 Chat endpoint called');

        const rate = await allowChatRequest(request);
        if (!rate.allowed) {
          const headers = corsHeaders(origin, env.ALLOWED_ORIGINS);
          headers.set('Retry-After', String(rate.retryAfterSeconds));
          return new Response(
            JSON.stringify({
              success: false,
              error: 'Rate limit exceeded',
              message: 'Too many chat requests. Please wait a minute and try again.',
            }),
            { status: 429, headers }
          );
        }

        try {
          let requestBody: {
            message: string;
            // Legacy single stock fields (optional)
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
            conversationHistory?: Array<{
              role: "user" | "assistant";
              content: string;
            }>;
            // Optional: News articles to summarize
            newsArticles?: Array<{
              headline: string;
              summary: string;
              url: string;
              date: string;
              source: string;
            }>;
          };
          
          try {
            requestBody = await request.json() as typeof requestBody;
          } catch (jsonError) {
            console.error('❌ JSON parsing error:', jsonError);
            return new Response(
              JSON.stringify({ 
                success: false,
                error: 'Invalid JSON in request body',
                message: jsonError instanceof Error ? jsonError.message : 'Unknown error'
              }),
              { 
                status: 400, 
                headers: corsHeaders(origin, env.ALLOWED_ORIGINS) 
              }
            );
          }
          
          console.log('📨 Chat request body received:', { 
            message: requestBody.message?.substring(0, 50),
            hasMessage: !!requestBody.message,
            hasWatchlist: !!requestBody.watchlist,
            watchlistSize: requestBody.watchlist?.length || 0,
            hasStockSymbol: !!requestBody.stockSymbol
          });

          if (!requestBody.message) {
            console.error('❌ Missing required field: message');
            return new Response(
              JSON.stringify({ 
                success: false,
                error: 'Missing required field: message' 
              }),
              { 
                status: 400, 
                headers: corsHeaders(origin, env.ALLOWED_ORIGINS) 
              }
            );
          }

          // Note: News requests are now handled by Gemini, which will determine if it's a watchlist or specific ticker
          // and format the response accordingly for the frontend to parse

          // Validate that we have either watchlist context or legacy stock fields
          const hasWatchlist = Array.isArray(requestBody.watchlist) && requestBody.watchlist.length > 0;
          const hasStockSymbol = !!requestBody.stockSymbol;
          
          if (!hasWatchlist && !hasStockSymbol) {
            console.error('❌ Missing required fields: either watchlist (with items) or stockSymbol must be provided');
            return new Response(
              JSON.stringify({ 
                success: false,
                error: 'Missing required fields: either watchlist (with items) or stockSymbol must be provided' 
              }),
              { 
                status: 400, 
                headers: corsHeaders(origin, env.ALLOWED_ORIGINS) 
              }
            );
          }

          // Build conversation history for Gemini
          const conversationHistory = requestBody.conversationHistory || [];
          
          // Build the system instruction with watchlist or stock context
          const systemInstruction = (requestBody.watchlist && requestBody.watchlist.length > 0)
            ? generateChatSystemInstruction(
                requestBody.watchlistName || 'the current watchlist',
                requestBody.watchlist,
                requestBody.selectedStockSymbol,
                requestBody.selectedStockName
              )
            : (requestBody.stockSymbol
              ? generateChatSystemInstruction(
                  requestBody.stockSymbol,
                  requestBody.stockName || requestBody.stockSymbol,
                  requestBody.stockData
                )
              : (() => {
                  // This should never happen due to validation above, but handle gracefully
                  console.error('❌ No watchlist or stockSymbol provided');
                  throw new Error('Missing required fields: either watchlist or stockSymbol must be provided');
                })());

          // Format messages for Gemini API
          // Gemini API format: contents array with alternating user/model messages
          const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

          // Add conversation history (skip the welcome message if it's the first assistant message)
          let skipFirstAssistant = conversationHistory.length > 0 && 
            conversationHistory[0]?.role === "assistant" &&
            conversationHistory[0]?.content?.includes("Hello! I can help you analyze");

          for (let i = skipFirstAssistant ? 1 : 0; i < conversationHistory.length; i++) {
            const msg = conversationHistory[i];
            contents.push({
              role: msg.role === "user" ? "user" : "model",
              parts: [{ text: msg.content }]
            });
          }

          // Add the current user message
          // Validate message is not empty
          if (!requestBody.message || requestBody.message.trim().length === 0) {
            return new Response(
              JSON.stringify({ 
                success: false,
                error: 'Message cannot be empty' 
              }),
              { 
                status: 400, 
                headers: corsHeaders(origin, env.ALLOWED_ORIGINS) 
              }
            );
          }
          
          // Build user message - include news articles if provided
          let userMessageText = requestBody.message.trim();
          
          if (requestBody.newsArticles && requestBody.newsArticles.length > 0) {
            // Limit articles to avoid token limits (max 10)
            const articlesToInclude = requestBody.newsArticles.slice(0, 10);
            console.log(`📰 Including ${articlesToInclude.length} news articles for summarization (limited from ${requestBody.newsArticles.length})`);
            
            // Format news articles for the user message - truncate summaries to avoid huge payloads
            const articlesText = articlesToInclude.map((article, index) => {
              // Truncate summary to max 200 chars to keep token count reasonable
              const truncatedSummary = article.summary.length > 200 
                ? article.summary.substring(0, 200) + '...' 
                : article.summary;
              
              return `Article ${index + 1}:
Headline: ${article.headline}
Summary: ${truncatedSummary}
Source: ${article.source}
Date: ${article.date}`;
            }).join('\n\n');
            
            userMessageText = `${userMessageText}\n\nPlease summarize the following ${articlesToInclude.length} news articles:\n\n${articlesText}`;
          }
          
          contents.push({
            role: "user",
            parts: [{ text: userMessageText }]
          });
          
          // Validate contents array is not empty
          if (contents.length === 0) {
            return new Response(
              JSON.stringify({ 
                success: false,
                error: 'Contents array cannot be empty' 
              }),
              { 
                status: 400, 
                headers: corsHeaders(origin, env.ALLOWED_ORIGINS) 
              }
            );
          }

          // Call Gemini API with streaming and retry logic
          // Using gemini-2.5-flash for fast and efficient responses
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=${env.GEMINI_API_KEY}`;
          
          const maxRetries = 3;
          let lastError: Error | null = null;
          let geminiResponse: Response | null = null;
          
          // Retry logic with exponential backoff
          let retryDelayMs = 0;
          for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
              if (attempt > 0) {
                // Use the retry delay from previous error if available, otherwise use exponential backoff
                const delay = retryDelayMs > 0 ? retryDelayMs : Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                console.log(`🔄 Retrying Gemini API (attempt ${attempt + 1}/${maxRetries}) after ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                retryDelayMs = 0; // Reset after using it
              }
              
              console.log(`📡 Calling Gemini API (streaming, attempt ${attempt + 1}/${maxRetries})...`);
              
              // Note: fetch_news tool removed - Gemini now responds with formatted text instead
              // Frontend parses the response and fetches news directly
              const tools: any[] = [];

              geminiResponse = await fetch(geminiUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  contents: contents,
                  systemInstruction: {
                    parts: [{ text: systemInstruction }]
                  },
                  tools: tools,
                  generationConfig: {
                    temperature: 0 // Use deterministic temperature for reliable function calling
                  }
                }),
              });

              if (geminiResponse.ok) {
                break; // Success, exit retry loop
              }
              
              // Check if error is retryable (5xx errors, 429 rate limit)
              const status = geminiResponse.status;
              const isRetryable = status >= 500 || status === 429;
              
              const errorText = await geminiResponse.text();
              
              // Parse error to extract retry delay for 429 errors
              if (status === 429) {
                try {
                  // Gemini returns errors in an array format: [{"error": {...}}]
                  const errorArray = JSON.parse(errorText);
                  const errorObj = Array.isArray(errorArray) ? errorArray[0] : errorArray;
                  const error = errorObj?.error;
                  
                  if (error?.details) {
                    const retryInfo = error.details.find((d: any) => d.retryDelay);
                    if (retryInfo?.retryDelay) {
                      // Parse retry delay (format: "29s" -> 29000ms)
                      const delayMatch = retryInfo.retryDelay.match(/(\d+)([smh])/);
                      if (delayMatch) {
                        const value = parseInt(delayMatch[1]);
                        const unit = delayMatch[2];
                        retryDelayMs = unit === 's' ? value * 1000 : unit === 'm' ? value * 60000 : value * 3600000;
                        // Add a small buffer (10%) and ensure minimum 1 second
                        retryDelayMs = Math.max(1000, Math.ceil(retryDelayMs * 1.1));
                        console.log(`⏱️ Rate limited. API suggests retry after ${retryInfo.retryDelay}, using ${retryDelayMs}ms`);
                      }
                    }
                  }
                } catch (e) {
                  console.warn('Failed to parse retry delay from error:', e);
                }
              }
              
              if (!isRetryable || attempt === maxRetries - 1) {
                // Non-retryable error or last attempt
                console.error(`❌ Gemini API error (${status}):`, errorText);
                
                // Try to parse the error to get full message
                try {
                  const errorArray = JSON.parse(errorText);
                  const errorObj = Array.isArray(errorArray) ? errorArray[0] : errorArray;
                  const error = errorObj?.error;
                  
                  // Provide user-friendly error message
                  let userMessage = errorText;
                  if (status === 429) {
                    userMessage = 'Rate limit exceeded. Please wait a moment and try again.';
                    if (retryDelayMs > 0) {
                      const retrySeconds = Math.ceil(retryDelayMs / 1000);
                      userMessage += ` (Retry after ${retrySeconds} seconds)`;
                    }
                  } else if (error?.message) {
                    userMessage = error.message;
                  }
                  
                  console.error('❌ Full Gemini error:', JSON.stringify(errorObj || errorArray, null, 2));
                  
                  // Create CORS headers
                  const headers = corsHeaders(origin, env.ALLOWED_ORIGINS);
                  
                  // Add Retry-After header for 429 errors
                  if (status === 429 && retryDelayMs > 0) {
                    headers.set('Retry-After', Math.ceil(retryDelayMs / 1000).toString());
                  }
                  
                  return new Response(
                    JSON.stringify({ 
                      success: false,
                      error: status === 429 ? 'Rate limit exceeded' : 'Gemini API error',
                      status: status,
                      message: userMessage,
                      retryAfter: status === 429 && retryDelayMs > 0 ? Math.ceil(retryDelayMs / 1000) : undefined
                    }),
                    { 
                      status: status === 429 ? 429 : 400, // Return 429 for rate limits
                      headers: headers
                    }
                  );
                } catch (e) {
                  console.error('❌ Error text (raw):', errorText);
                  
                  return new Response(
                    JSON.stringify({ 
                      success: false,
                      error: status === 429 ? 'Rate limit exceeded' : 'Gemini API error',
                      status: status,
                      message: status === 429 ? 'Rate limit exceeded. Please wait a moment and try again.' : errorText
                    }),
                    { 
                      status: status === 429 ? 429 : 400,
                      headers: corsHeaders(origin, env.ALLOWED_ORIGINS) 
                    }
                  );
                }
              }
              
              // Retryable error, continue to next attempt
              console.warn(`⚠️ Gemini API error (${status}), will retry:`, errorText.substring(0, 200));
              if (status === 429 && retryDelayMs > 0) {
                console.log(`⏱️ Will wait ${retryDelayMs}ms before retry (from API suggestion)`);
              }
              lastError = new Error(`API error: ${status}`);
              
            } catch (error) {
              lastError = error instanceof Error ? error : new Error(String(error));
              console.warn(`⚠️ Gemini API request failed (attempt ${attempt + 1}/${maxRetries}):`, lastError.message);
              
              if (attempt === maxRetries - 1) {
                // Last attempt failed
                console.error('❌ All retry attempts failed');
                return new Response(
                  JSON.stringify({ 
                    success: false,
                    error: 'Failed to connect to Gemini API after retries',
                    message: lastError.message
                  }),
                  { 
                    status: 500, 
                    headers: corsHeaders(origin, env.ALLOWED_ORIGINS) 
                  }
                );
              }
            }
          }

          if (!geminiResponse || !geminiResponse.ok) {
            return new Response(
              JSON.stringify({ 
                success: false,
                error: 'Failed to get response from Gemini API',
                message: lastError?.message || 'Unknown error'
              }),
              { 
                status: 500, 
                headers: corsHeaders(origin, env.ALLOWED_ORIGINS) 
              }
            );
          }

          console.log('✅ Gemini API response OK, starting stream...');
          console.log('📊 Response headers:', Object.fromEntries(geminiResponse.headers.entries()));
          console.log('📊 Contents length:', contents.length);
          console.log('📊 System instruction length:', systemInstruction?.length || 0);

          // Define tools/functions available to Gemini (same as above, needed in stream handler)
          const tools = [{
            functionDeclarations: [{
              name: 'fetch_news',
              description: 'Fetches the most recent news articles from financial news sources for one or more stock ticker symbols. Use this function to get up-to-date information about company announcements, earnings reports, analyst ratings, market movements, and other news that may affect stock prices. This function returns an array of news articles, each containing a headline, summary, publication date, source, and URL. Always use this function when users ask about recent news, events, headlines, or what\'s happening with stocks - do not attempt to answer news questions without calling this function first.',
              parameters: {
                type: 'object',
                properties: {
                  symbols: {
                    type: 'string',
                    description: 'A single stock ticker symbol (e.g., "AAPL") or a comma-separated list of symbols (e.g., "AAPL,MSFT,TSLA"). All symbols must be valid ticker symbols from the watchlist.'
                  },
                  limit: {
                    type: 'number',
                    description: 'The maximum number of news articles to retrieve. Default is 10, maximum is 10. Use this to control how many articles you want to review.'
                  }
                },
                required: ['symbols']
              }
            }]
          }];

          // Create a streaming response
          const stream = new ReadableStream({
            async start(controller) {
              let reader = geminiResponse.body?.getReader();
              let decoder = new TextDecoder();
              
              if (!reader) {
                console.error('❌ No reader available');
                controller.close();
                return;
              }

              let lastText = '';
              let buffer = '';
              let hasSentData = false;
              let rawBuffer = ''; // For debugging
              let currentContents = [...contents]; // Track contents for function calls
              let streamComplete = false; // Flag to track if we've completed the stream

              try {
                while (true) {
                  if (streamComplete) break;
                  
                  const { done, value } = await reader.read();
                  
                  if (done) {
                    console.log('✅ Stream completed, sent data:', hasSentData);
                    console.log('📦 Raw buffer at end (first 500):', rawBuffer.substring(0, 500));
                    console.log('📦 Raw buffer at end (last 500):', rawBuffer.substring(Math.max(0, rawBuffer.length - 500)));
                    console.log('📦 Total raw buffer length:', rawBuffer.length);
                    console.log('📦 Buffer length:', buffer.length);
                    
                    if (!hasSentData) {
                      // Try one more time to parse any remaining buffer
                      if (buffer.trim()) {
                        try {
                          const json = JSON.parse(buffer.trim());
                          console.log('🔍 Final buffer parse:', JSON.stringify(json).substring(0, 300));
                          const candidate = json.candidates?.[0];
                          if (candidate?.content?.parts) {
                            for (const part of candidate.content.parts) {
                              if (part.text) {
                                const currentText = part.text;
                                const newText = currentText.slice(lastText.length);
                                if (newText) {
                                  lastText = currentText;
                                  hasSentData = true;
                                  const chunk = `data: ${JSON.stringify({ type: 'chunk', text: newText })}\n\n`;
                                  controller.enqueue(new TextEncoder().encode(chunk));
                                }
                              }
                            }
                          }
                        } catch (e) {
                          console.warn('Failed to parse final buffer:', e);
                        }
                      }
                      
                      if (!hasSentData) {
                        // If still no data, fallback to non-streaming API
                        console.log('⚠️ No data from streaming, falling back to non-streaming API...');
                        console.log('📊 Stream stats - buffer length:', buffer.length, 'rawBuffer length:', rawBuffer.length);
                        console.log('📊 Last 500 chars of rawBuffer:', rawBuffer.substring(Math.max(0, rawBuffer.length - 500)));
                        
                        try {
                          const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
                          console.log('🔄 Calling fallback API...');
                          const fallbackResponse = await fetch(fallbackUrl, {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                              contents: contents,
                              systemInstruction: {
                                parts: [{ text: systemInstruction }]
                              },
                              tools: tools, // Include tools in fallback too
                              generationConfig: {
                                temperature: 0.7
                              }
                            }),
                          });
                          
                          console.log('📡 Fallback response status:', fallbackResponse.status, fallbackResponse.statusText);
                          
                          if (fallbackResponse.ok) {
                            const fallbackData = await fallbackResponse.json() as {
                              candidates?: Array<{
                                content?: {
                                  parts?: Array<{
                                    text?: string;
                                    functionCall?: any;
                                  }>;
                                };
                              }>;
                              error?: {
                                message?: string;
                                code?: number;
                              };
                            };
                            
                            console.log('📦 Fallback response data:', JSON.stringify(fallbackData).substring(0, 500));
                            
                            // Check for errors in response
                            if (fallbackData.error) {
                              console.error('❌ Fallback API error:', fallbackData.error);
                              const errorChunk = `data: ${JSON.stringify({ type: 'error', message: `Gemini API error: ${fallbackData.error.message || 'Unknown error'}` })}\n\n`;
                              controller.enqueue(new TextEncoder().encode(errorChunk));
                              hasSentData = true; // Mark as sent so we don't send duplicate error
                            } else {
                              const responseText = fallbackData.candidates?.[0]?.content?.parts?.[0]?.text;
                              if (responseText) {
                                // Send the full response as a single chunk
                                const chunk = `data: ${JSON.stringify({ type: 'chunk', text: responseText })}\n\n`;
                                controller.enqueue(new TextEncoder().encode(chunk));
                                hasSentData = true;
                                console.log('✅ Fallback API succeeded');
                              } else {
                                console.warn('⚠️ Fallback API returned no text in response');
                                console.log('📦 Full fallback response:', JSON.stringify(fallbackData));
                              }
                            }
                          } else {
                            const errorText = await fallbackResponse.text();
                            console.error('❌ Fallback API failed with status:', fallbackResponse.status);
                            console.error('❌ Error response:', errorText.substring(0, 500));
                            
                            // Try to parse error
                            try {
                              const errorJson = JSON.parse(errorText);
                              const errorMessage = errorJson.error?.message || errorText.substring(0, 200);
                              const errorChunk = `data: ${JSON.stringify({ type: 'error', message: `Gemini API error (${fallbackResponse.status}): ${errorMessage}` })}\n\n`;
                              controller.enqueue(new TextEncoder().encode(errorChunk));
                              hasSentData = true;
                            } catch (e) {
                              const errorChunk = `data: ${JSON.stringify({ type: 'error', message: `Gemini API error (${fallbackResponse.status}): ${errorText.substring(0, 200)}` })}\n\n`;
                              controller.enqueue(new TextEncoder().encode(errorChunk));
                              hasSentData = true;
                            }
                          }
                        } catch (fallbackError) {
                          console.error('❌ Fallback API exception:', fallbackError);
                          const errorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
                          const errorChunk = `data: ${JSON.stringify({ type: 'error', message: `Failed to call Gemini API: ${errorMessage}` })}\n\n`;
                          controller.enqueue(new TextEncoder().encode(errorChunk));
                          hasSentData = true;
                        }
                        
                        if (!hasSentData) {
                          // If fallback also failed, send error
                          console.error('❌ Both streaming and fallback APIs failed to return data');
                          const errorChunk = `data: ${JSON.stringify({ type: 'error', message: 'No data received from Gemini. Please check your API key and try again.' })}\n\n`;
                          controller.enqueue(new TextEncoder().encode(errorChunk));
                        }
                      }
                    }
                    
                    // Check if sources should be shown and send metadata
                    if (lastText && requestBody.message) {
                      const showSources = shouldShowSources(lastText, requestBody.message);
                      if (showSources) {
                        const metadataChunk = `data: ${JSON.stringify({ type: 'metadata', showSources: true })}\n\n`;
                        controller.enqueue(new TextEncoder().encode(metadataChunk));
                      }
                    }
                    
                    controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
                    controller.close();
                    break;
                  }

                  const decoded = decoder.decode(value, { stream: true });
                  buffer += decoded;
                  rawBuffer += decoded;
                  
                  // Gemini streams JSON objects, one per line
                  const lines = buffer.split('\n');
                  buffer = lines.pop() || ''; // Keep incomplete line

                  lineLoop: for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    
                    try {
                      const json = JSON.parse(trimmed);
                      console.log('📨 Parsed JSON:', JSON.stringify(json).substring(0, 300));
                      
                      const candidate = json.candidates?.[0];
                      
                      // Check for function calls
                      if (candidate?.content?.parts) {
                        // Log all parts to debug
                        console.log('📦 Parts received:', JSON.stringify(candidate.content.parts).substring(0, 500));
                        
                        for (const part of candidate.content.parts) {
                          // Handle function calls - check both camelCase and snake_case formats
                          const functionCall = part.functionCall || part.function_call;
                          if (functionCall) {
                            const functionName = functionCall.name || functionCall.function_name;
                            const functionArgs = functionCall.args || functionCall.arguments || {};
                            console.log('🔧 Function call detected:', functionName, 'args:', functionArgs);
                            
                            if (functionName === 'fetch_news') {
                              const args = functionArgs;
                              const limit = args.limit || 10;
                              
                              // Get symbols from args.symbols, or fallback to selected stock or first stock in watchlist
                              let symbolsParam = args.symbols;
                              
                              // If no symbols in args, try fallback to selected stock or first stock in watchlist
                              if (!symbolsParam) {
                                symbolsParam = requestBody.selectedStockSymbol 
                                  || (requestBody.watchlist && requestBody.watchlist.length > 0 ? requestBody.watchlist[0].symbol : null)
                                  || requestBody.stockSymbol;
                              }
                              
                              // Parse symbols - handle both single symbol and comma-separated list
                              const symbolsList: string[] = symbolsParam 
                                ? symbolsParam.split(',').map((s: string) => s.trim().toUpperCase()).filter((s: string) => s.length > 0)
                                : [];
                              
                              // Validate symbols - check if they're valid stock tickers from the watchlist
                              let isValidSymbols = true;
                              let invalidSymbols: string[] = [];
                              
                              if (requestBody.watchlist && requestBody.watchlist.length > 0) {
                                const watchlistSymbols = requestBody.watchlist.map(s => s.symbol.toUpperCase());
                                
                                // Check each symbol
                                for (const symbol of symbolsList) {
                                  if (!watchlistSymbols.includes(symbol)) {
                                    isValidSymbols = false;
                                    invalidSymbols.push(symbol);
                                  }
                                }
                                
                                // If any symbols are invalid (e.g., watchlist name), ask user to specify
                                if (!isValidSymbols) {
                                  const watchlistSymbolsList = requestBody.watchlist.map(s => s.symbol).join(', ');
                                  const invalidList = invalidSymbols.join(', ');
                                  const errorMessage = `I can't fetch news for "${invalidList}" as that's not a valid stock ticker. Please tell me which specific stock(s) from your watchlist you'd like news about. Available stocks: ${watchlistSymbolsList}`;
                                  
                                  // Send error message to client
                                  const errorChunk = `data: ${JSON.stringify({ type: 'chunk', text: errorMessage })}\n\n`;
                                  controller.enqueue(new TextEncoder().encode(errorChunk));
                                  hasSentData = true;
                                  lastText = errorMessage;
                                  
                                  // Send [DONE] and close
                                  controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
                                  controller.close();
                                  streamComplete = true;
                                  break lineLoop;
                                }
                              }
                              
                              // If no valid symbols found, ask user to specify
                              if (symbolsList.length === 0 || !isValidSymbols) {
                                const watchlistSymbolsList = requestBody.watchlist && requestBody.watchlist.length > 0
                                  ? requestBody.watchlist.map(s => s.symbol).join(', ')
                                  : 'your watchlist';
                                const errorMessage = `I need a specific stock ticker to fetch news. Please tell me which stock from ${watchlistSymbolsList} you'd like news about.`;
                                
                                // Send error message to client
                                const errorChunk = `data: ${JSON.stringify({ type: 'chunk', text: errorMessage })}\n\n`;
                                controller.enqueue(new TextEncoder().encode(errorChunk));
                                hasSentData = true;
                                lastText = errorMessage;
                                
                                // Send [DONE] and close
                                controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
                                controller.close();
                                streamComplete = true;
                                break lineLoop;
                              }
                              
                              // Join symbols with comma for API call
                              const symbolsString = symbolsList.join(',');
                              
                              // Send a brief acknowledgment message first
                              const symbolDisplay = symbolsList.length === 1 
                                ? symbolsList[0] 
                                : `${symbolsList.length} stocks`;
                              const acknowledgmentMessage = `Let me fetch the latest news for ${symbolDisplay}...\n\n`;
                              
                              // Send acknowledgment as text chunk first
                              const ackChunk = `data: ${JSON.stringify({ type: 'chunk', text: acknowledgmentMessage })}\n\n`;
                              controller.enqueue(new TextEncoder().encode(ackChunk));
                              hasSentData = true;
                              lastText = acknowledgmentMessage;
                              
                              // Send function call to frontend - let frontend execute it
                              // This avoids extra API calls and reduces rate limiting
                              const funcChunk = `data: ${JSON.stringify({ 
                                type: 'function_call', 
                                name: 'fetch_news', 
                                symbol: symbolsString,
                                limit: limit
                                // No articles - frontend will fetch them
                              })}\n\n`;
                              controller.enqueue(new TextEncoder().encode(funcChunk));
                              hasSentData = true;
                              
                              // Close the stream - frontend will handle fetching and displaying news
                              controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
                              controller.close();
                              streamComplete = true;
                              break lineLoop;
                                break;
                            }
                          }
                          
                          // Handle text responses
                          if (part.text) {
                            // Gemini returns cumulative text, extract only new part
                            const currentText = part.text;
                            const newText = currentText.slice(lastText.length);
                            
                            // Filter out code-like text that Gemini sometimes generates
                            // Remove print(fetch_news(...)) patterns
                            // Remove code blocks with function calls (```python fetch_news(...) ```)
                            // Remove "Tool Call:" sections with code
                            let filteredText = newText
                              .replace(/print\s*\(\s*fetch_news\s*\([^)]*\)\s*\)/gi, '')
                              .replace(/```\s*(?:python|javascript|js|typescript|ts)?\s*fetch_news\s*\([^)]*\)\s*```/gi, '')
                              .replace(/\*\*Tool Call\*\*:\s*```[^`]*```/gi, '')
                              .replace(/Tool Call:\s*```[^`]*```/gi, '')
                              .trim();
                            
                            console.log(`📝 Text: lastText.length=${lastText.length}, currentText.length=${currentText.length}, newText.length=${newText.length}`);
                            
                            if (filteredText) {
                              // Update lastText to currentText (full cumulative) to track what Gemini sent
                              // We send filteredText to frontend but track full text to prevent re-processing
                              lastText = currentText;
                              hasSentData = true;
                              const chunk = `data: ${JSON.stringify({ type: 'chunk', text: filteredText })}\n\n`;
                              controller.enqueue(new TextEncoder().encode(chunk));
                            } else if (newText.trim()) {
                              // If text was filtered out, still update lastText to prevent re-processing
                              lastText = currentText;
                            }
                          } else if (!part.functionCall) {
                            console.log('⚠️ Part has no text or functionCall:', JSON.stringify(part).substring(0, 200));
                          }
                        }
                      } else {
                        // Log if we get a response but no text
                        console.log('⚠️ Received response but no candidate/content/parts:', JSON.stringify(json).substring(0, 300));
                      }
                    } catch (e) {
                      // Skip invalid JSON (might be partial)
                      console.warn('Failed to parse line:', trimmed.substring(0, 200));
                      continue;
                    }
                  }
                }
                
                // If stream completed via streamComplete flag (e.g., after function call), ensure we close properly
                if (streamComplete) {
                  console.log('✅ Stream completed via streamComplete flag, sent data:', hasSentData);
                  
                  // Check if sources should be shown and send metadata
                  if (lastText && requestBody.message) {
                    const showSources = shouldShowSources(lastText, requestBody.message);
                    if (showSources) {
                      const metadataChunk = `data: ${JSON.stringify({ type: 'metadata', showSources: true })}\n\n`;
                      controller.enqueue(new TextEncoder().encode(metadataChunk));
                    }
                  }
                  
                  // Send [DONE] marker and close
                  controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
                  controller.close();
                }
              } catch (error) {
                console.error('Streaming error:', error);
                const errorChunk = `data: ${JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : 'Unknown error' })}\n\n`;
                controller.enqueue(new TextEncoder().encode(errorChunk));
                controller.error(error);
              }
            }
          });

          // Return streaming response with SSE headers
          const headers = corsHeaders(origin, env.ALLOWED_ORIGINS);
          headers.set('Content-Type', 'text/event-stream');
          headers.set('Cache-Control', 'no-cache');
          headers.set('Connection', 'keep-alive');

          return new Response(stream, {
            status: 200,
            headers: headers,
          });
        } catch (error) {
          console.error('Chat API error:', error);
          return new Response(
            JSON.stringify({ 
              success: false,
              error: 'Failed to process chat message',
              message: error instanceof Error ? error.message : 'Unknown error'
            }),
            { 
              status: 500, 
              headers: corsHeaders(origin, env.ALLOWED_ORIGINS) 
            }
          );
        }
      }

      // Route: Get news articles from Alpaca
      if (requestUrl.pathname === '/api/news' && request.method === 'GET') {
        try {
          // Get optional query parameters
          const symbols = requestUrl.searchParams.get('symbols'); // Optional: filter by symbols
          const start = requestUrl.searchParams.get('start'); // Optional: start date (ISO 8601)
          const end = requestUrl.searchParams.get('end'); // Optional: end date (ISO 8601)
          const limit = requestUrl.searchParams.get('limit') || '10'; // Default to 10 articles
          const sort = requestUrl.searchParams.get('sort') || 'desc'; // Default to descending (newest first)
          
          // Build Alpaca news API URL
          const alpacaUrl = new URL('https://data.alpaca.markets/v1beta1/news');
          if (symbols) {
            alpacaUrl.searchParams.set('symbols', symbols);
          }
          if (start) {
            alpacaUrl.searchParams.set('start', start);
          }
          if (end) {
            alpacaUrl.searchParams.set('end', end);
          }
          alpacaUrl.searchParams.set('limit', limit);
          alpacaUrl.searchParams.set('sort', sort);
          
          console.log(`📰 Fetching news from Alpaca: ${alpacaUrl.toString()}`);
          
          // Call Alpaca News API with authentication
          const alpacaResponse = await fetch(alpacaUrl.toString(), {
            method: 'GET',
            headers: {
              'APCA-API-KEY-ID': env.ALPACA_API_KEY,
              'APCA-API-SECRET-KEY': env.ALPACA_API_SECRET,
            },
          });
          
          if (!alpacaResponse.ok) {
            const errorText = await alpacaResponse.text();
            console.error(`Alpaca News API error (${alpacaResponse.status}):`, errorText);
            return new Response(
              JSON.stringify({ 
                success: false,
                error: 'Alpaca News API error',
                status: alpacaResponse.status,
                message: errorText 
              }),
              { 
                status: alpacaResponse.status, 
                headers: corsHeaders(origin, env.ALLOWED_ORIGINS) 
              }
            );
          }
          
          const newsData = await alpacaResponse.json() as { news?: any[] } | any[];
          
          // Handle both response formats: { news: [...] } or [...]
          const articles = Array.isArray(newsData) 
            ? newsData 
            : (newsData.news || []);
          
          console.log(`✅ Successfully fetched ${articles.length} news articles`);
          
          return new Response(
            JSON.stringify({ 
              success: true, 
              data: articles
            }),
            {
              status: 200,
              headers: corsHeaders(origin, env.ALLOWED_ORIGINS),
            }
          );
        } catch (error) {
          console.error('News API error:', error);
          return new Response(
            JSON.stringify({ 
              success: false,
              error: 'Failed to fetch news',
              message: error instanceof Error ? error.message : 'Unknown error'
            }),
            { 
              status: 500, 
              headers: corsHeaders(origin, env.ALLOWED_ORIGINS) 
            }
          );
        }
      }

      // Route: Get historical price for a specific date (supports multiple symbols)
      if (requestUrl.pathname === '/api/historical-price' && request.method === 'GET') {
        try {
          const symbolsParam = requestUrl.searchParams.get('symbols') || requestUrl.searchParams.get('symbol');
          const date = requestUrl.searchParams.get('date'); // Format: YYYY-MM-DD
          
          if (!symbolsParam || !date) {
            return new Response(
              JSON.stringify({ 
                success: false,
                error: 'Missing symbols or date parameter' 
              }),
              { 
                status: 400, 
                headers: corsHeaders(origin, env.ALLOWED_ORIGINS) 
              }
            );
          }
          
          const baseUrl = 'https://data.alpaca.markets';
          const headers = {
            'APCA-API-KEY-ID': env.ALPACA_API_KEY,
            'APCA-API-SECRET-KEY': env.ALPACA_API_SECRET,
          };
          
          // Fetch individual bars for each symbol (Alpaca's batch endpoint seems unreliable)
          // According to docs: https://docs.alpaca.markets/reference/stockbars
          // adjustment=all returns split-adjusted and dividend-adjusted prices (o, h, l, c)
          const symbols = symbolsParam.toUpperCase();
          const symbolList = symbols.split(',').map(s => s.trim());
          
          console.log(`Fetching historical prices for ${symbolList.length} symbols individually`);
          
          // Fetch all symbols in parallel (Alpaca free tier: 200 calls/minute, so 10 symbols is fine)
          // Only batch if we have more than 20 symbols
          const batchSize = symbolList.length > 20 ? 20 : symbolList.length;
          const batches: string[][] = [];
          for (let i = 0; i < symbolList.length; i += batchSize) {
            batches.push(symbolList.slice(i, i + batchSize));
          }
          
          const symbolResults: Array<{ symbol: string; data: any }> = [];
          
          for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            
            // Fetch batch in parallel with improved retry logic
            const batchPromises = batch.map(async (symbol) => {
              const maxRetries = 5; // Increased from 2 to handle transient failures better
              let lastError: Error | null = null;
              
              for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                  const barsUrl = `${baseUrl}/v2/stocks/${symbol}/bars?timeframe=1Day&start=${date}&end=${date}&limit=1&feed=iex&adjustment=all`;
                  const barsResponse = await fetch(barsUrl, { headers });
                  
                  if (!barsResponse.ok) {
                    // Don't retry on 404 (no data for that date is normal)
                    if (barsResponse.status === 404) {
                      return { symbol, data: null };
                    }
                    
                    // Retry on 429 (rate limit) or 5xx errors
                    if (barsResponse.status === 429 || barsResponse.status >= 500) {
                      if (attempt < maxRetries) {
                        // Exponential backoff: 200ms, 500ms, 1000ms, 2000ms, 4000ms
                        const delay = Math.min(200 * Math.pow(2, attempt), 4000);
                        console.log(`🔄 Retrying ${symbol} (attempt ${attempt + 1}/${maxRetries + 1}) after ${delay}ms due to ${barsResponse.status}`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                      }
                    }
                    
                    return { symbol, data: null };
                  }
                  
                  const barsData = await barsResponse.json() as { 
                    bars?: Array<{ t: string; o: number; h: number; l: number; c: number; v: number; vw?: number }>;
                    [key: string]: unknown;
                  };
                  
                  if (barsData.bars && barsData.bars.length > 0) {
                    const bar = barsData.bars[0];
                    return {
                      symbol,
                      data: {
                        symbol: symbol,
                        date: bar.t.split('T')[0],
                        open: bar.o,
                        high: bar.h,
                        low: bar.l,
                        close: bar.c,
                        volume: bar.v,
                        vwap: bar.vw
                      }
                    };
                  } else {
                    return { symbol, data: null };
                  }
                } catch (error) {
                  lastError = error instanceof Error ? error : new Error(String(error));
                  // Retry on network errors
                  if (attempt < maxRetries) {
                    // Exponential backoff: 200ms, 500ms, 1000ms, 2000ms, 4000ms
                    const delay = Math.min(200 * Math.pow(2, attempt), 4000);
                    console.log(`🔄 Retrying ${symbol} (attempt ${attempt + 1}/${maxRetries + 1}) after ${delay}ms due to network error`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                  }
                }
              }
              
              // All retries failed
              console.warn(`❌ Failed to fetch ${symbol} after ${maxRetries + 1} attempts:`, lastError?.message);
              return { symbol, data: null };
            });
            
            const batchResults = await Promise.all(batchPromises);
            symbolResults.push(...batchResults);
            
            // Only add delay between batches if we have multiple batches and not the last one
            if (batches.length > 1 && i < batches.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 50)); // Reduced from 100ms
            }
          }
          
          // Build result object
          const result: Record<string, {
            symbol: string;
            date: string;
            open: number;
            high: number;
            low: number;
            close: number;
            volume: number;
            vwap?: number;
          }> = {};
          
          symbolResults.forEach(({ symbol, data }) => {
            if (data) {
              result[symbol] = data;
            }
          });
          
          console.log(`Successfully fetched ${Object.keys(result).length} out of ${symbolList.length} symbols`);
          
          // Log which symbols are missing
          const requestedSymbols = symbolList.map(s => s.toUpperCase());
          const missingSymbols = requestedSymbols.filter(s => !result[s]);
          if (missingSymbols.length > 0) {
            console.warn(`Missing data for ${missingSymbols.length} symbols on ${date}: ${missingSymbols.join(', ')}`);
          }
          
          console.log(`Returning ${Object.keys(result).length} price results out of ${requestedSymbols.length} requested`);
          
          return new Response(
            JSON.stringify({ 
              success: true,
              data: result
            }),
            {
              status: 200,
              headers: corsHeaders(origin, env.ALLOWED_ORIGINS),
            }
          );
        } catch (error) {
          console.error('Historical price API error:', error);
          return new Response(
            JSON.stringify({ 
              success: false,
              error: 'Failed to fetch historical price',
              message: error instanceof Error ? error.message : 'Unknown error'
            }),
            { 
              status: 500, 
              headers: corsHeaders(origin, env.ALLOWED_ORIGINS) 
            }
          );
        }
      }

      // 404 for unknown routes
      return new Response(
        JSON.stringify({ error: 'Not found' }),
        { 
          status: 404, 
          headers: corsHeaders(origin, env.ALLOWED_ORIGINS) 
        }
      );
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(
        JSON.stringify({ 
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error'
        }),
        { 
          status: 500, 
          headers: corsHeaders(origin, env.ALLOWED_ORIGINS) 
        }
      );
    }
  },
};


