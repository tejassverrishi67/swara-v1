/**
 * Token-bucket rate limiter (Features.md F-22).
 */

import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { createRateLimiter } from "./rate-limit.ts";

interface FakeRes {
  statusCode: number;
  headers: Record<string, string>;
  setHeader(k: string, v: string): void;
  status(code: number): FakeRes;
  json: ReturnType<typeof vi.fn>;
}

function fakeReqRes(ip = "1.2.3.4") {
  const req = { ip, socket: { remoteAddress: ip }, userId: undefined } as unknown as Request;
  const res: FakeRes = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json: vi.fn(),
  };
  return { req, res: res as unknown as Response & FakeRes };
}

describe("createRateLimiter", () => {
  it("allows up to perMinute + burst requests then 429s", () => {
    const limit = createRateLimiter({ perMinute: 5, burst: 3 }); // capacity 8
    const { req, res } = fakeReqRes();
    let allowed = 0;
    for (let i = 0; i < 8; i++) {
      const next = vi.fn();
      limit(req, res, next);
      if (next.mock.calls.length) allowed++;
    }
    expect(allowed).toBe(8);

    const next = vi.fn();
    limit(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.headers["Retry-After"]).toBeTruthy();
  });

  it("buckets are per-key, so a second IP is unaffected", () => {
    const limit = createRateLimiter({ perMinute: 1, burst: 0 });
    const a = fakeReqRes("10.0.0.1");
    const b = fakeReqRes("10.0.0.2");

    const n1 = vi.fn();
    limit(a.req, a.res, n1);
    expect(n1).toHaveBeenCalled();

    const n2 = vi.fn();
    limit(a.req, a.res, n2);
    expect(n2).not.toHaveBeenCalled(); // A is now limited

    const n3 = vi.fn();
    limit(b.req, b.res, n3);
    expect(n3).toHaveBeenCalled(); // B has its own bucket
  });

  it("refills over time", () => {
    let t = 1_000_000;
    const limit = createRateLimiter({ perMinute: 60, burst: 0, now: () => t }); // capacity 60, 1 token/sec

    const { req, res } = fakeReqRes();
    // Drain the full bucket.
    for (let i = 0; i < 60; i++) limit(req, res, vi.fn());

    const blocked = vi.fn();
    limit(req, res, blocked);
    expect(blocked).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);

    t += 2000; // ~2 tokens refilled
    const afterWait = vi.fn();
    limit(req, res, afterWait);
    expect(afterWait).toHaveBeenCalled();
  });
});
