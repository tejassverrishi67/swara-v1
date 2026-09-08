/**
 * Device / session identity (Features.md F-05)
 * ===========================================
 *
 * `backend/server.ts` used to hold ONE Trust Ladder and ONE provenance log with
 * no notion of who was asking — so a pin made by one person would cause a second
 * person's device on the same backend to speak immediately, with no Meaning
 * Check. That is a direct violation of "instant tier only by explicit user
 * action" (SWARA_KNOWLEDGE.md §9b).
 *
 * This module issues an opaque, HMAC-signed device id in an http-only cookie and
 * attaches it to every request as `req.userId`. It is NOT a client-supplied
 * header field (those are trivially spoofed) — the signature is verified
 * server-side against `SESSION_SECRET`.
 *
 * Single-user mode: when `SESSION_SECRET` is empty the middleware is a no-op and
 * `req.userId` is `undefined`; the server additionally refuses to bind to a
 * non-loopback address (enforced in server.ts).
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export interface DeviceSessionOptions {
  secret: string;
  cookieName: string;
  ttlDays: number;
  /** Mark the cookie `Secure` (set false only for plain-HTTP local dev). */
  secure?: boolean;
}

/** `<id>.<base64url hmac>` — tamper-evident, not encrypted (the id is opaque anyway). */
export function signSessionId(id: string, secret: string): string {
  const mac = createHmac("sha256", secret).update(id).digest("base64url");
  return `${id}.${mac}`;
}

/** Returns the id if the signature verifies, else `undefined`. */
export function verifySessionId(token: string, secret: string): string | undefined {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const id = token.slice(0, dot);
  const given = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(id).digest("base64url");
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
  return id;
}

/** Minimal cookie-header parser (avoids a cookie-parser dependency). */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Signed device/session id, or undefined in single-user mode (F-05). */
      userId?: string;
    }
  }
}

/**
 * Express middleware. Reads the signed cookie, mints one on first contact, and
 * sets `req.userId`. No-op when `secret` is empty (single-user mode).
 */
export function deviceSession(options: DeviceSessionOptions) {
  const { secret, cookieName, ttlDays, secure } = options;
  const maxAge = Math.max(1, Math.round(ttlDays * 24 * 60 * 60));

  return function deviceSessionMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (!secret) {
      next();
      return;
    }

    const cookies = parseCookies(req.headers.cookie);
    let id = cookies[cookieName] ? verifySessionId(cookies[cookieName]!, secret) : undefined;

    if (!id) {
      id = randomUUID();
      const attrs = [
        `${cookieName}=${encodeURIComponent(signSessionId(id, secret))}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${maxAge}`,
      ];
      if (secure ?? true) attrs.push("Secure");
      res.append("Set-Cookie", attrs.join("; "));
    }

    req.userId = id;
    next();
  };
}

/**
 * Namespace a Trust Ladder / cache key by user so two people on one backend can
 * never see or trigger each other's entries (F-05). "local" for single-user mode.
 */
export function scopeKey(userId: string | undefined, key: string): string {
  return `${userId ?? "local"}::${key}`;
}
