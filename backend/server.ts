/**
 * SWARA backend HTTP server
 * =========================
 *
 * Thin Express adapter. All real logic lives in `api/<name>/handler.ts` (pure,
 * framework-agnostic async functions) and `lib/*`. This file only:
 *   - parses/validates request bodies via each handler's `parse*Request`,
 *   - maps results and errors to HTTP,
 *   - owns the process-wide singletons (Trust Ladder, Provenance log).
 *
 * Swapping Express for Fastify / a serverless runtime / Next.js route handlers
 * should not require touching anything under the api handlers or the lib folder.
 *
 * Endpoints:
 *   GET  /health
 *   POST /api/interpret              -> InterpretationResult
 *   POST /api/generate-expressions   -> GenerateExpressionsResponse
 *   POST /api/tts                    -> TtsResponse
 *
 * Deliberately NOT exposed yet (SPEC.md §4): any provenance *read* endpoint, and
 * anything resembling a caregiver/clinician dashboard. The provenance library
 * supports reads; no HTTP surface is given to them in this pass.
 */

import "./load-env.ts"; // MUST be first: populates process.env from swara/.env before CONFIG is read.

import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import cors, { type CorsOptions } from "cors";

import type { ApiError, Concept } from "@swara/shared";
import { CONFIG, isLoopbackHost } from "./lib/config.ts";
import { conceptCombinationKey, TrustLadder, FileTrustLadderStore, InMemoryTrustLadderStore } from "./lib/trust-ladder.ts";
import {
  ProvenanceLog,
  createProvenanceStore,
  validateNewProvenanceRecord,
} from "./lib/provenance.ts";
import { deviceSession, scopeKey } from "./lib/identity.ts";
import { createRateLimiter } from "./lib/rate-limit.ts";
import { assertVoiceConfig, SUPPORTED_LANGUAGES, voicesForModel } from "./lib/voices.ts";

import { interpret, parseInterpretRequest } from "./api/interpret/handler.ts";
import {
  generateExpressions,
  parseGenerateExpressionsRequest,
} from "./api/generate-expressions/handler.ts";
import { synthesizeSpeech, parseTtsRequest } from "./api/tts/handler.ts";
import { importOpenBoard, listPalettes } from "./api/palette/handler.ts";

/**
 * Local validation error. `errorHandler` maps anything whose `name` is
 * "InvalidRequestError" to HTTP 400 (the per-handler classes use the same name);
 * this one covers the routes wired directly in this file.
 */
class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRequestError";
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Process-wide singletons
 * ────────────────────────────────────────────────────────────────────────────
 * These are constructed once and would be injected into handlers when the
 * handlers start needing them (the Antigravity pass wires the Trust Ladder into
 * the flow and Provenance into the speak path). They are created here so there
 * is exactly one place that decides which storage backend is in use.
 */
export const trustLadder = new TrustLadder(
  CONFIG.provenance.backend === "file"
    ? new FileTrustLadderStore("./data/trust-ladder.json")
    : new InMemoryTrustLadderStore(),
);

export const provenance = new ProvenanceLog(
  createProvenanceStore({
    backend: CONFIG.provenance.backend,
    filePath: CONFIG.provenance.filePath,
  }),
  {
    retentionDays: CONFIG.provenance.retentionDays,
    redact: CONFIG.provenance.redact,
  },
);

/** Order-independent Trust Ladder key, namespaced by the requesting device (F-05). */
function ladderKey(req: Request, concepts: Concept[]): string {
  return scopeKey(req.userId, conceptCombinationKey(concepts));
}

/* ────────────────────────────────────────────────────────────────────────────
 * CORS + rate limiting (Features.md F-22)
 * ──────────────────────────────────────────────────────────────────────────── */

function corsOptions(): CorsOptions {
  const raw = CONFIG.server.corsOrigins.trim();
  if (raw === "*") {
    console.warn("[server] CORS_ORIGINS=* — every origin is allowed. Do not deploy like this.");
    return { origin: true, credentials: true };
  }
  const allowlist = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // Empty ⇒ local dev only: reflect localhost/127.0.0.1 on any port.
  const localDev = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  return {
    credentials: true,
    origin(origin, cb) {
      if (!origin) return cb(null, true); // same-origin / curl / server-to-server
      if (allowlist.length === 0 ? localDev.test(origin) : allowlist.includes(origin)) {
        return cb(null, true);
      }
      cb(new Error(`Origin ${origin} is not allowed by CORS`));
    },
  };
}

const spendingRateLimit = createRateLimiter({
  perMinute: CONFIG.server.rateLimitPerMinute,
  burst: CONFIG.server.rateLimitBurst,
});

/* ────────────────────────────────────────────────────────────────────────────
 * App
 * ──────────────────────────────────────────────────────────────────────────── */

export function createServer() {
  const app = express();
  app.set("trust proxy", true); // so req.ip reflects X-Forwarded-For behind a reverse proxy

  app.use(cors(corsOptions()));
  app.use(express.json({ limit: "64kb" }));
  app.use(
    deviceSession({
      secret: CONFIG.identity.sessionSecret,
      cookieName: CONFIG.identity.cookieName,
      ttlDays: CONFIG.identity.ttlDays,
      secure: !isLoopbackHost(CONFIG.server.host),
    }),
  );

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      llm: CONFIG.llm.enabled ? CONFIG.llm.provider : "mock",
      tts: CONFIG.sarvam.enabled ? "sarvam" : "mock",
      provenanceBackend: CONFIG.provenance.backend,
      identity: CONFIG.identity.sessionSecret ? "multi-user" : "single-user",
    });
  });

  /**
   * F-13 / F-14: the voices valid for the configured Bulbul model, and the
   * languages Bulbul supports. The frontend's voice + language pickers read this
   * so it can never offer a speaker that will 400 at speak time.
   */
  app.get("/api/voices", (_req, res) => {
    res.json({
      model: CONFIG.sarvam.model,
      defaultSpeaker: CONFIG.sarvam.defaultSpeaker,
      defaultLanguage: CONFIG.sarvam.defaultLanguage,
      voices: voicesForModel(CONFIG.sarvam.model),
      languages: SUPPORTED_LANGUAGES,
    });
  });

  app.post("/api/interpret", spendingRateLimit, asyncRoute(async (req, res) => {
    const parsed = parseInterpretRequest(req.body);
    res.json(await interpret(parsed));
  }));

  app.post("/api/generate-expressions", spendingRateLimit, asyncRoute(async (req, res) => {
    const parsed = parseGenerateExpressionsRequest(req.body);
    res.json(await generateExpressions(parsed));
  }));

  app.post("/api/tts", spendingRateLimit, asyncRoute(async (req, res) => {
    const parsed = parseTtsRequest(req.body);
    res.json(await synthesizeSpeech(parsed));
  }));

  /* ── Concept palettes (Features.md F-10) ────────────────────────────────── */

  app.get("/api/palettes", (_req, res) => {
    res.json({ palettes: listPalettes() });
  });

  app.post("/api/palettes/import", asyncRoute(async (req, res) => {
    // Accepts an Open Board Format (.obf) JSON object.
    res.json({ palette: importOpenBoard(req.body) });
  }));

  /* ── Trust Ladder routes (keyed by device — F-05) ───────────────────────── */

  app.post("/api/trust-ladder/status", asyncRoute(async (req, res) => {
    const key = ladderKey(req, parseConceptsList(req.body));
    const tier = await trustLadder.tierFor(key);
    const explanation = await trustLadder.explain(key);
    const entry = await trustLadder.getEntry(key);
    res.json({ tier, explanation, entry });
  }));

  app.post("/api/trust-ladder/confirm", asyncRoute(async (req, res) => {
    const key = ladderKey(req, parseConceptsList(req.body));
    const confirmedInterpretation = req.body?.confirmedInterpretation;
    if (typeof confirmedInterpretation !== "string" || confirmedInterpretation.trim() === "") {
      res.status(400).json({ error: { code: "INVALID_REQUEST", message: "confirmedInterpretation is required" } });
      return;
    }
    const entry = await trustLadder.confirm(key, confirmedInterpretation.trim());
    res.json({ entry });
  }));

  app.post("/api/trust-ladder/pin", asyncRoute(async (req, res) => {
    const key = ladderKey(req, parseConceptsList(req.body));
    const pinnedText = req.body?.pinnedText;
    if (typeof pinnedText !== "string" || pinnedText.trim() === "") {
      res.status(400).json({ error: { code: "INVALID_REQUEST", message: "pinnedText is required" } });
      return;
    }
    const entry = await trustLadder.pin(key, pinnedText.trim());
    res.json({ entry });
  }));

  app.post("/api/trust-ladder/unpin", asyncRoute(async (req, res) => {
    const key = ladderKey(req, parseConceptsList(req.body));
    const entry = await trustLadder.unpin(key);
    res.json({ entry });
  }));

  /* ── Provenance silent write route ──────────────────────────────────────── */

  app.post("/api/provenance/log", asyncRoute(async (req, res) => {
    // Reject structurally incomplete records rather than silently persisting a
    // junk audit entry — reconstructing what happened is a hard requirement here
    // (SWARA_KNOWLEDGE.md §9c), so a malformed record is a 400, not a 200.
    const problems = validateNewProvenanceRecord(req.body);
    if (problems.length > 0) {
      throw new InvalidRequestError(`Invalid provenance record: ${problems.join("; ")}`);
    }
    // Stamp the owner server-side (F-05) — never trust a userId from the body.
    const record = await provenance.record({ ...req.body, userId: req.userId });
    // `ok` reflects whether the write actually succeeded — record() swallows
    // store errors and returns undefined.
    res.json({ ok: record !== undefined, id: record?.id });
  }));

  /**
   * User-controlled deletion path (F-06). Scoped to the caller's own device;
   * requires an explicit `confirm: true` so it cannot fire by accident.
   */
  app.post("/api/provenance/purge", asyncRoute(async (req, res) => {
    if (req.body?.confirm !== true) {
      throw new InvalidRequestError("Set `confirm: true` to delete your communication history.");
    }
    const removed = await provenance.purge(
      CONFIG.identity.sessionSecret ? { userId: req.userId } : undefined,
    );
    res.json({ ok: true, removed });
  }));

  /* ── Static frontend (single-process local deploy) ──────────────────────── */
  // When a production build exists at swara/frontend/dist, serve it from this
  // same process so one `npm run start` gives the whole app on one origin (no
  // CORS, no second server). Skipped entirely in dev / tests where dist is absent.
  const distDir = path.resolve(fileURLToPath(new URL("../frontend/dist", import.meta.url)));
  if (existsSync(path.join(distDir, "index.html"))) {
    app.use(express.static(distDir, { index: false, maxAge: "1h" }));
    app.get(/^\/(?!api\/|health$).*/, (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
    console.log(`[server] serving frontend build from ${distDir}`);
  }

  app.use(errorHandler);
  return app;
}

function parseConceptsList(body: unknown): Concept[] {
  if (typeof body !== "object" || body === null || !("concepts" in body)) {
    throw new InvalidRequestError("Body must include a `concepts` array.");
  }
  const { concepts } = body as { concepts: unknown };
  if (!Array.isArray(concepts) || concepts.length === 0) {
    throw new InvalidRequestError("`concepts` must be a non-empty array.");
  }
  for (let i = 0; i < concepts.length; i++) {
    const c = concepts[i] as Partial<Concept> | null;
    if (
      typeof c !== "object" ||
      c === null ||
      typeof c.id !== "string" ||
      typeof c.emoji !== "string" ||
      typeof c.label !== "string"
    ) {
      throw new InvalidRequestError(`concepts[${i}] must be { id, emoji, label } strings.`);
    }
  }
  return concepts as Concept[];
}

/* ────────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────────── */

/** Wrap an async route so rejected promises reach the error handler. */
function asyncRoute(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

/** Any handler that throws `*InvalidRequestError` (name-matched) -> 400; CORS -> 403; else 500. */
function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const message = err instanceof Error ? err.message : "Unknown error";
  const isValidation = err instanceof Error && err.name === "InvalidRequestError";
  const isCors = /not allowed by CORS/i.test(message);

  const status = isValidation ? 400 : isCors ? 403 : 500;
  const body: ApiError = {
    error: {
      code: isValidation ? "INVALID_REQUEST" : isCors ? "ORIGIN_NOT_ALLOWED" : "INTERNAL_ERROR",
      message,
    },
  };
  if (!isValidation && !isCors) console.error("[server] unhandled error:", err);
  res.status(status).json(body);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Entrypoint (only when run directly, not when imported by tests)
 * ──────────────────────────────────────────────────────────────────────────── */

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const host = CONFIG.server.host;

  // F-14: a v2 speaker on a v3 model (or vice-versa) is a 400 from Sarvam at the
  // first utterance. Catch it here instead.
  try {
    assertVoiceConfig(CONFIG.sarvam.model, CONFIG.sarvam.defaultSpeaker);
  } catch (err) {
    console.error(`\n[server] REFUSING TO START.\n  ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  // F-05: without an identity secret there is exactly one Trust Ladder and one
  // provenance log for everyone who can reach the port — one person's pin would
  // let another person's device speak with no Meaning Check. Refuse to expose
  // that beyond loopback. Make the unsafe configuration hard to reach by accident.
  if (!CONFIG.identity.sessionSecret && !isLoopbackHost(host)) {
    console.error(
      `\n[server] REFUSING TO START.\n` +
        `  HOST is "${host}" (not loopback) but SESSION_SECRET is empty.\n` +
        `  In this mode every client shares one Trust Ladder and one audit log, so\n` +
        `  one user's pinned "instant" phrase can make another user's device speak\n` +
        `  immediately with no Meaning Check (Features.md F-05).\n` +
        `  Set SESSION_SECRET to enable per-device identity, or bind HOST to 127.0.0.1.\n`,
    );
    process.exit(1);
  }
  if (!isLoopbackHost(host) && !CONFIG.sarvam.enabled) {
    console.warn("[server] WARNING: bound to a public interface with no TLS story here — terminate TLS at a reverse proxy (see swara/README.md).");
  }

  const app = createServer();
  app.listen(CONFIG.port, host, () => {
    console.log(`SWARA backend listening on http://${host}:${CONFIG.port}`);
    console.log(
      `  LLM: ${CONFIG.llm.enabled ? CONFIG.llm.provider : "mock"} | ` +
        `TTS: ${CONFIG.sarvam.enabled ? "sarvam" : "mock"} | ` +
        `provenance: ${CONFIG.provenance.backend} (retention ${CONFIG.provenance.retentionDays}d${CONFIG.provenance.redact ? ", redacted" : ""}) | ` +
        `identity: ${CONFIG.identity.sessionSecret ? "multi-user" : "single-user"}`,
    );
  });
}
