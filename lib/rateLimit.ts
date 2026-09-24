/**
 * In-memory sliding-window rate limiter. This works correctly as long as the app runs
 * as a single Node.js process (true for the target Raspberry Pi / single-VM deployment).
 * It would silently stop being effective if the app were horizontally scaled across
 * multiple processes/instances without a shared store (e.g. Redis) — noted here and in
 * the architecture review rather than pretending this scales further than it does.
 */
const buckets = new Map<string, { count: number; windowStart: number }>();

export function checkRateLimit(key: string, maxAttempts: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart > windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= maxAttempts;
}

// Periodically forget old buckets so this doesn't grow unbounded on a long-running process.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.windowStart > 10 * 60 * 1000) buckets.delete(key);
  }
}, 5 * 60 * 1000).unref?.();
