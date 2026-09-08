/**
 * Token-bucket rate limiting (Features.md F-22)
 * ============================================
 *
 * `/interpret`, `/generate-expressions` and `/tts` all spend money per call, and
 * before this there was nothing stopping anyone who could reach the port from
 * draining the API budget (or writing into a shared Trust Ladder). This is a
 * small in-memory limiter — per IP and, when identity is on, per user.
 *
 * AAC users legitimately send many short messages under stress, so the default
 * is generous (a full minute's budget as burst on top of the steady rate) and
 * the limiter is opt-in per route, applied only to the spending endpoints.
 *
 * In-process only. A multi-instance deployment puts a shared limiter (Redis, or
 * the reverse proxy) in front — see swara/README.md.
 */

import type { NextFunction, Request, Response } from "express";

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface RateLimitOptions {
  /** Sustained requests allowed per minute. */
  perMinute: number;
  /** Extra tokens available for a burst on top of the steady rate. */
  burst: number;
  /** How to bucket a request. Defaults to IP + userId. */
  keyOf?: (req: Request) => string;
  /** Clock injection point — tests pass a controllable one. */
  now?: () => number;
}

export function createRateLimiter(options: RateLimitOptions) {
  const capacity = Math.max(1, options.perMinute + options.burst);
  const refillPerMs = options.perMinute / 60_000;
  const clock = options.now ?? Date.now;
  const buckets = new Map<string, Bucket>();

  const keyOf =
    options.keyOf ??
    ((req: Request) => `${req.ip ?? req.socket.remoteAddress ?? "unknown"}|${req.userId ?? "-"}`);

  // Opportunistic GC so the map cannot grow without bound.
  let lastGc = Date.now();
  function gc(now: number): void {
    if (now - lastGc < 5 * 60_000) return;
    lastGc = now;
    for (const [k, b] of buckets) {
      if (now - b.updatedAt > 10 * 60_000) buckets.delete(k);
    }
  }

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const now = clock();
    gc(now);
    const key = keyOf(req);
    const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: now };
    bucket.tokens = Math.min(capacity, bucket.tokens + (now - bucket.updatedAt) * refillPerMs);
    bucket.updatedAt = now;

    if (bucket.tokens < 1) {
      const retryAfter = Math.ceil((1 - bucket.tokens) / refillPerMs / 1000);
      buckets.set(key, bucket);
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests in a short window. Please wait a moment and try again.",
        },
      });
      return;
    }

    bucket.tokens -= 1;
    buckets.set(key, bucket);
    next();
  };
}
