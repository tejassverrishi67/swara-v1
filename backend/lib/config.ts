/**
 * Centralised backend configuration: tunable constants and environment access.
 *
 * Everything that a future tuning pass might want to change lives here, not
 * scattered through the code. Values are documented with *why* the default is
 * what it is, since none of them have been validated against real users yet
 * (SWARA_KNOWLEDGE.md §12).
 */

/* ────────────────────────────────────────────────────────────────────────────
 * Trust Ladder tuning
 * ──────────────────────────────────────────────────────────────────────────── */
export const TRUST_LADDER = {
  /**
   * Number of confirmed uses (with the *same* confirmed interpretation) after
   * which a combination is automatically promoted from "full" to "fast".
   *
   * Rationale for 3: enough repetition to be confident the interpretation is
   * stable for this user, few enough that a frequently-used phrase stops
   * demanding the full flow quickly. Purely a guess — revisit with real usage.
   */
  PROMOTE_TO_FAST_AFTER_CONFIRMED_USES: 3,
} as const;

/* ────────────────────────────────────────────────────────────────────────────
 * Interpretation ranking thresholds (used by the /interpret stub and, later,
 * the real implementation to decide "single answer" vs "ranked shortlist").
 * ──────────────────────────────────────────────────────────────────────────── */
export const INTERPRETATION = {
  /**
   * If the top candidate's confidence is >= this AND it beats the runner-up by
   * at least AMBIGUITY_MARGIN, return just that one interpretation.
   */
  HIGH_CONFIDENCE_THRESHOLD: 0.78,
  /**
   * Minimum confidence gap between #1 and #2 for #1 to stand alone. Below this
   * the reading is "ambiguous" and a shortlist is returned
   * (SWARA_KNOWLEDGE.md §9a).
   */
  AMBIGUITY_MARGIN: 0.15,
  /** Never show more than this many ranked candidates. */
  MAX_RANKED: 3,
  /** When ambiguous, show at least this many. */
  MIN_RANKED: 2,
} as const;

/* ────────────────────────────────────────────────────────────────────────────
 * Environment
 * ──────────────────────────────────────────────────────────────────────────── */

import { defaultSpeakerFor } from "./voices.ts";

/** Read an env var, falling back to a default. Trims whitespace; "" counts as unset. */
function env(name: string, fallback = ""): string {
  const raw = process.env[name];
  const value = (raw ?? "").trim();
  return value === "" ? fallback : value;
}

export const CONFIG = {
  /** HTTP port for the backend server. */
  port: Number(env("PORT", "8787")),

  llm: {
    /** e.g. "anthropic" | "openai" | "". Empty -> deterministic mock client. */
    provider: env("LLM_PROVIDER"),
    apiKey: env("LLM_API_KEY"),
    model: env("LLM_MODEL"),
    /** True when a real provider is configured. */
    get enabled(): boolean {
      return this.provider !== "" && this.apiKey !== "";
    },
  },

  sarvam: {
    apiKey: env("SARVAM_API_KEY"),
    /** "v2" | "v3" | "v3-beta" — decision pending (SPEC.md §3d). */
    model: env("SARVAM_MODEL", "v2"),
    /**
     * Default speaker offered to a new user. Falls back to a model-appropriate
     * voice when unset; `assertVoiceConfig()` still fails startup on an explicit
     * mismatch (Features.md F-14).
     */
    defaultSpeaker:
      env("SARVAM_DEFAULT_SPEAKER") || defaultSpeakerFor(env("SARVAM_MODEL", "v2")),
    /** Default TTS language when the client does not specify one (Features.md F-13). */
    defaultLanguage: env("SARVAM_DEFAULT_LANGUAGE", "en-IN"),
    /** True when a real key is present. Empty -> mock audio. */
    get enabled(): boolean {
      return this.apiKey !== "";
    },
    /** Endpoints kept here so there is one place to update them. */
    endpoints: {
      /** REST real-time synthesis — full/fast tier. */
      rest: "https://api.sarvam.ai/text-to-speech",
      /** WebSocket streaming synthesis — instant tier (latency-critical). */
      websocket: "wss://api.sarvam.ai/text-to-speech/ws",
    },
  },

  provenance: {
    /**
     * "memory" | "file". Defaults to **file** (Features.md F-06): the whole point
     * of provenance is reconstructing what happened after the fact, and `memory`
     * discards the trail on every restart.
     */
    backend: env("PROVENANCE_BACKEND", "file") as "memory" | "file",
    /** Used only when backend === "file". */
    filePath: env("PROVENANCE_FILE_PATH", "./data/provenance.jsonl"),
    /**
     * Records older than this many days are pruned opportunistically on write and
     * on demand (Features.md F-06). These records carry medical-symptom content;
     * 90 days is the documented default (see SPEC.md §9). 0 disables pruning.
     */
    retentionDays: Number(env("PROVENANCE_RETENTION_DAYS", "90")),
    /**
     * When true, store concept ids + structure but NOT the final spoken text or
     * interpretation/expression strings (Features.md F-06). For users who want the
     * accountability trail without the transcript.
     */
    redact: env("PROVENANCE_REDACT", "").toLowerCase() === "true",
  },

  /* ──────────────────────────────────────────────────────────────────────────
   * Identity + deployment safety (Features.md F-05, F-22)
   * ────────────────────────────────────────────────────────────────────────── */
  identity: {
    /**
     * HMAC secret for the device-session cookie. When empty, the server runs in
     * single-user mode and REFUSES to bind to a non-loopback address (F-05).
     */
    sessionSecret: env("SESSION_SECRET"),
    /** Cookie name for the signed device/session id. */
    cookieName: env("SESSION_COOKIE_NAME", "swara_device"),
    /** Days a device session stays valid. */
    ttlDays: Number(env("SESSION_TTL_DAYS", "365")),
  },

  server: {
    /**
     * Interface to bind. Defaults to loopback. Binding anywhere else without an
     * identity secret is refused at startup (F-05).
     */
    host: env("HOST", "127.0.0.1"),
    /**
     * Comma-separated list of allowed CORS origins (F-22). Empty ⇒ reflect
     * localhost dev origins only. "*" is accepted but logged as unsafe.
     */
    corsOrigins: env("CORS_ORIGINS", ""),
    /** Per-IP request budget for the money-spending endpoints, per minute (F-22). */
    rateLimitPerMinute: Number(env("RATE_LIMIT_PER_MINUTE", "60")),
    /** Burst allowance on top of the per-minute rate (F-22). */
    rateLimitBurst: Number(env("RATE_LIMIT_BURST", "20")),
  },
} as const;

/** True when a non-loopback bind address is configured. */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "127.0.0.1" || h === "::1" || h === "localhost" || h === "";
}
