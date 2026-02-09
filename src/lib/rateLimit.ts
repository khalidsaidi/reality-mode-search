const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const LIMIT = 30;

// In-memory, per-instance. Good enough when combined with CDN caching.
const buckets = new Map<string, number[]>();

export function rateLimit(ip: string, nowMs = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
  const key = ip || "unknown";
  const times = buckets.get(key) ?? [];

  const cutoff = nowMs - WINDOW_MS;
  while (times.length > 0 && times[0] < cutoff) times.shift();

  if (times.length >= LIMIT) {
    const oldest = times[0] ?? nowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + WINDOW_MS - nowMs) / 1000));
    buckets.set(key, times);
    return { allowed: false, retryAfterSeconds };
  }

  times.push(nowMs);
  buckets.set(key, times);
  return { allowed: true, retryAfterSeconds: 0 };
}

