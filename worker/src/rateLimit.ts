/**
 * Simple per-IP rate limiting via the Cache API (works across isolates in a colo).
 */

const CHAT_LIMIT = 30;
const CHAT_WINDOW_SECONDS = 60;

function clientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'anonymous'
  );
}

/**
 * Returns true if the request is allowed, false if it should be rejected with 429.
 */
export async function allowChatRequest(request: Request): Promise<{
  allowed: boolean;
  retryAfterSeconds: number;
}> {
  const ip = clientIp(request);
  const bucket = Math.floor(Date.now() / (CHAT_WINDOW_SECONDS * 1000));
  const cacheKey = new Request(`https://rate-limit.internal/chat/${encodeURIComponent(ip)}/${bucket}`);
  const cache = caches.default;

  let count = 0;
  try {
    const existing = await cache.match(cacheKey);
    if (existing) {
      count = Number.parseInt(await existing.text(), 10) || 0;
    }
  } catch {
    // If cache is unavailable, fail open so chat still works.
    return { allowed: true, retryAfterSeconds: CHAT_WINDOW_SECONDS };
  }

  if (count >= CHAT_LIMIT) {
    return { allowed: false, retryAfterSeconds: CHAT_WINDOW_SECONDS };
  }

  try {
    await cache.put(
      cacheKey,
      new Response(String(count + 1), {
        headers: {
          'Cache-Control': `public, max-age=${CHAT_WINDOW_SECONDS}`,
        },
      })
    );
  } catch {
    // Ignore put failures; request already counted as allowed.
  }

  return { allowed: true, retryAfterSeconds: CHAT_WINDOW_SECONDS };
}
