import type { ArbitrageSnapshot, ScanResult } from './types';

interface CachedScan {
  key: string;
  snapshot: ArbitrageSnapshot;
  allScanResults: ScanResult[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 300_000;
const STALE_CACHE_TTL_MS = 30 * 60_000;
const EDGE_CACHE_ORIGIN = 'https://predictions-cache.internal';

let memoryCache: CachedScan | null = null;

function edgeCacheRequest(key: string): Request {
  return new Request(`${EDGE_CACHE_ORIGIN}/scan/${encodeURIComponent(key)}`);
}

export function getCachedScan(key: string): CachedScan | null {
  if (!memoryCache || memoryCache.key !== key || Date.now() - memoryCache.fetchedAt > CACHE_TTL_MS) {
    return null;
  }

  return memoryCache;
}

export async function getStaleCachedScan(key: string): Promise<CachedScan | null> {
  if (
    memoryCache &&
    memoryCache.key === key &&
    Date.now() - memoryCache.fetchedAt <= STALE_CACHE_TTL_MS
  ) {
    return memoryCache;
  }

  const response = await caches.default.match(edgeCacheRequest(key));
  if (!response) {
    return null;
  }

  try {
    const cached = (await response.json()) as CachedScan;
    if (cached.key !== key || Date.now() - cached.fetchedAt > STALE_CACHE_TTL_MS) {
      return null;
    }

    memoryCache = cached;
    return cached;
  } catch {
    return null;
  }
}

export async function getEdgeCachedScan(key: string): Promise<CachedScan | null> {
  const inMemory = getCachedScan(key);
  if (inMemory) {
    return inMemory;
  }

  const response = await caches.default.match(edgeCacheRequest(key));
  if (!response) {
    return null;
  }

  try {
    const cached = (await response.json()) as CachedScan;
    if (cached.key !== key || Date.now() - cached.fetchedAt > CACHE_TTL_MS) {
      return null;
    }

    memoryCache = cached;
    return cached;
  } catch {
    return null;
  }
}

export function setCachedScan(
  key: string,
  snapshot: ArbitrageSnapshot,
  allScanResults: ScanResult[]
): CachedScan {
  memoryCache = {
    key,
    snapshot,
    allScanResults,
    fetchedAt: Date.now(),
  };
  return memoryCache;
}

export async function setEdgeCachedScan(
  key: string,
  snapshot: ArbitrageSnapshot,
  allScanResults: ScanResult[]
): Promise<CachedScan> {
  const cached = setCachedScan(key, snapshot, allScanResults);
  await caches.default.put(
    edgeCacheRequest(key),
    new Response(JSON.stringify(cached), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `max-age=${Math.floor(CACHE_TTL_MS / 1000)}`,
      },
    })
  );
  return cached;
}

export function buildPaginatedSnapshot(
  cached: CachedScan,
  offset: number,
  limit: number
): ArbitrageSnapshot {
  return {
    ...cached.snapshot,
    scanResults: cached.allScanResults.slice(offset, offset + limit),
    scanResultsTotal: cached.allScanResults.length,
    scanOffset: offset,
    scanLimit: limit,
  };
}
