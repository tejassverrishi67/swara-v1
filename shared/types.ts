/**
 * SWARA — shared type definitions
 * =================================
 *
 * The single source of truth for the data shapes that cross the frontend/backend
 * boundary. Both workspaces import from here (`import type { Concept } from "@swara/shared"`).
 *
 * Read `SWARA_KNOWLEDGE.md` for the product model these types encode. The short
 * version: the user picks **concepts**, SWARA proposes an **interpretation** (or a
 * ranked shortlist when ambiguous), the user **confirms** the meaning, SWARA
 * offers **expression options**, the user approves one, and only then is it
 * spoken. The **Trust Ladder** decides how much of that flow is required for a
 * given concept combination, and the **Provenance** layer records what happened.
 *
 * Conventions:
 *  - These are the canonical domain types. The seven required by the architecture
 *    brief are marked "SPEC TYPE". Everything else is an additive request/response
 *    envelope or helper and is documented as such in ../SPEC.md §2.
 *  - Keep this file dependency-free and runtime-free (types + const enums of
 *    string unions only) so it can be imported from any environment.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * 1. Concepts
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * SPEC TYPE. One building block of a thought — an emoji/symbol tile the user taps.
 * A message is expressed as an unordered *set* of these (see `conceptCombinationKey`
 * in backend/lib/trust-ladder.ts).
 */
export interface Concept {
  /** Stable identifier, e.g. "doctor", "leg", "pain", "worse". Used for keying. */
  id: string;
  /** The glyph shown on the tile, e.g. "👨‍⚕️". Display-only; never keyed on. */
  emoji: string;
  /** Human-readable label, e.g. "doctor". Fed to the LLM alongside the emoji. */
  label: string;
  /** ADDITIVE (F-10). Category this concept belongs to within its palette. */
  category?: string;
  /**
   * ADDITIVE (F-13). Localised labels keyed by locale ("hi-IN" → "डॉक्टर").
   * Literal mode and the tile use the active locale's label when present.
   */
  labels?: Record<string, string>;
  /** ADDITIVE (F-10). A data-URI image used instead of `emoji` when set (imported boards). */
  image?: string;
  /** ADDITIVE (F-10). True for a tile the user created themselves. */
  userDefined?: boolean;
}

/**
 * SPEC TYPE-adjacent (Features.md F-10). A concept board: SWARA sits *on top of*
 * existing AAC boards (SWARA_KNOWLEDGE.md §10), so the palette is data, not the
 * 14 hard-coded demo tiles it used to be.
 */
export interface ConceptPalette {
  /** Stable id, e.g. "medical", or "import-<uuid>" for a user import. */
  id: string;
  /** Display name, e.g. "Medical & symptoms". */
  name: string;
  /** BCP-47-ish locale of the labels, e.g. "en-IN". */
  locale: string;
  /** Ordered category names; every concept's `category` should be one of these. */
  categories: string[];
  /** The tiles. */
  concepts: Concept[];
  /** Where it came from: a bundled starter board, or a user OBF/OBZ import. */
  source: "bundled" | "import";
}

/** Response for `GET /api/palettes`. */
export interface PalettesResponse {
  palettes: ConceptPalette[];
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2. Interpretation (concepts -> candidate meaning)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * SPEC TYPE. One candidate reading of the selected concepts, in plain language.
 * Produced by /interpret. Must contain **only** meaning derivable from the
 * concepts — no invented facts, severity, timeframe, or detail
 * (SWARA_KNOWLEDGE.md §7, §8).
 */
export interface Interpretation {
  /** Plain-language statement of what the concepts appear to mean. */
  text: string;
  /**
   * Model confidence in this reading, 0..1. Used by the frontend and the Trust
   * Ladder to decide whether to show a single interpretation or a ranked
   * shortlist. Thresholds live in backend/lib/config.ts, not here.
   */
  confidence: number;
}

/**
 * Where a user-facing result actually came from (Features.md F-02). The user must
 * never be shown template/fallback text with the same confidence as a real model
 * result without knowing which it is.
 *  - "model":    a real LLM produced it and it passed the fidelity gate.
 *  - "fallback": the deterministic offline template — the LLM was unreachable,
 *                returned malformed output, or is not configured.
 *  - "literal":  a plain concept-label rendering, used to fill in when the model
 *                could not produce enough meaning-safe phrasings (fail-closed).
 */
export type ResultSource = "model" | "fallback" | "literal";

/**
 * Attached to a degraded result so the UI can show a plain, non-alarming line
 * explaining why the user is not looking at a fresh model result (Features.md F-02).
 */
export interface DegradedInfo {
  /**
   *  - "unreachable":    the LLM call failed (network, timeout, HTTP error) or
   *                      returned unparseable output.
   *  - "fidelity":       the LLM answered, but too few candidates preserved the
   *                      confirmed meaning — a different, louder event than
   *                      "unreachable" and logged as a fidelity rejection.
   *  - "not-configured": no LLM provider is set; the app is running on templates.
   */
  reason: "unreachable" | "fidelity" | "not-configured";
  /** One short sentence, safe to render verbatim to the user. */
  message: string;
}

/** A model candidate the fidelity gate refused, kept for provenance (Features.md F-04). */
export interface RejectedCandidate {
  text: string;
  /** Human-readable reason, e.g. "invented-severity: \"excruciating\"". */
  reason: string;
}

/**
 * SPEC TYPE. The full result of /interpret.
 *
 * `interpretations` is **ranked, most likely first**, and contains:
 *  - exactly 1 entry when the top reading is clearly ahead (high confidence), or
 *  - 2–3 entries when the reading is ambiguous, so the UI can show an
 *    "A / B / C" shortlist rather than silently guessing (SWARA_KNOWLEDGE.md §9a).
 */
export interface InterpretationResult {
  /** Echo of the concepts this result was computed from, in selection order. */
  concepts: Concept[];
  /** Ranked candidate meanings. Length 1 (confident) or 2–3 (ambiguous). */
  interpretations: Interpretation[];
  /** ADDITIVE (F-02). Where these interpretations came from. Absent ⇒ "model". */
  source?: ResultSource;
  /** ADDITIVE (F-02). Present only when `source` is not "model". */
  degraded?: DegradedInfo;
  /** ADDITIVE (F-04). Candidates the fidelity gate rejected on the model path. */
  rejectedCandidates?: RejectedCandidate[];
  /** ADDITIVE (F-04). LLM provider/model that produced (or failed) this result. */
  llmProvider?: string;
  llmModel?: string;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3. Expression (confirmed meaning -> ways to say it)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * SPEC TYPE. One way of expressing an already-confirmed intent, coloured by one
 * plausible emotional tone.
 *
 * IMPORTANT: `emotion` is an **AI-suggested emotional reading** the user may pick
 * from — never an asserted fact about how the user feels. The three sibling
 * options carry three distinct emotions chosen per-message (e.g. "Sad",
 * "Frustrated", "Neutral / calm"); there is no fixed trio. Nothing is staged to
 * speak until the user explicitly selects one. Treat `emotion` as a short
 * free-text label for display only.
 */
export interface ExpressionOption {
  /** AI-suggested emotional tone for this phrasing (a short label, for the user to choose). */
  emotion: string;
  /** The candidate sentence to potentially speak. Same meaning as every sibling option. */
  text: string;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 4. Trust Ladder (how much confirmation this combination needs)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * SPEC TYPE. The three tiers of confirmation friction (SWARA_KNOWLEDGE.md §9b).
 *  - "full":    new / low-confidence combo. Show interpretation, require confirm,
 *               show 3 expressions, require choice.
 *  - "fast":    combo seen before with the same interpretation reconfirmed. Show
 *               interpretation briefly, one-tap confirm, skip to expressions.
 *  - "instant": user has explicitly pinned this exact combo to a fixed phrase.
 *               Speaks immediately, no confirmation. **Never entered automatically.**
 */
export type TrustTier = "full" | "fast" | "instant";

/**
 * SPEC TYPE. Persisted state for one concept combination in the Trust Ladder.
 * Keyed by `conceptCombinationKey` (order-independent; see backend/lib/trust-ladder.ts).
 */
export interface TrustLadderEntry {
  /** Canonical, order-independent key for the concept set. */
  conceptCombinationKey: string;
  /** Current tier for this combination. */
  tier: TrustTier;
  /**
   * The interpretation text the user has been confirming for this combination.
   * If a later confirmation selects a *different* meaning, the ladder resets
   * (tier -> "full", useCount -> 1) so a drifted meaning can't ride an old
   * promotion. Absent until the first confirmation.
   */
  approvedInterpretation?: string;
  /**
   * The fixed phrase to speak when `tier === "instant"`. Set **only** by an
   * explicit user pin action. Absent for "full"/"fast".
   */
  pinnedText?: string;
  /**
   * Count of confirmed uses with `approvedInterpretation` unchanged. Drives the
   * automatic full -> fast promotion. Reset to 1 when the confirmed meaning changes.
   */
  useCount: number;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 5. Provenance (what actually happened, for later reconstruction)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * SPEC TYPE. One silently-written audit record per spoken message, across every
 * tier (SWARA_KNOWLEDGE.md §9c). Invisible by default; surfaced only on request
 * ("say that again", consented clinician review). Writing it must never block or
 * delay the user-facing flow.
 *
 * The nine fields below are the required schema. `id` and `meta` are additive
 * (documented in ../SPEC.md §2) and may be ignored by callers that only need the
 * required shape.
 */
export interface ProvenanceRecord {
  /** Assigned by the store on write; unset on records handed to `record()`. */
  id?: string;

  /**
   * ADDITIVE (F-05). The device/session this message belongs to. Stamped
   * server-side from the signed session cookie — never trusted from the client
   * body. Absent in single-user mode. Every provenance read is scoped by it.
   */
  userId?: string;

  /** ISO 8601 timestamp of when the message was approved/spoken. */
  timestamp: string;
  /** The concepts the user selected, in selection order. */
  concepts: Concept[];
  /**
   * The interpretation(s) SWARA derived for this message. There is no longer a
   * user-facing Meaning Check, so this is the AI's own reading(s), logged for
   * audit rather than shown for confirmation.
   */
  interpretationsShown: Interpretation[];
  /**
   * Kept for schema compatibility. Always `null` now — the flow has no manual
   * interpretation-confirmation step (it was removed along with the Meaning
   * Check); the audit trail relies on `interpretationsShown` + `meta.emotion`.
   */
  interpretationConfirmed: Interpretation | null;
  /** Which Trust Ladder tier governed this message. */
  tierUsed: TrustTier;
  /**
   * The emotion options offered to the user for this message. Empty for the
   * "instant" tier, which skips emotion selection.
   */
  expressionOptionsShown: ExpressionOption[];
  /** The exact text that was spoken. */
  finalApprovedText: string;
  /** True if the user hand-edited the text after picking/among the options. */
  wasManuallyEdited: boolean;

  /**
   * ADDITIVE, optional. Context that aids later reconstruction but is not part of
   * the required schema. Safe to omit. See ../SPEC.md §2.
   */
  meta?: ProvenanceMeta;
}

/** ADDITIVE. Optional context attached to a {@link ProvenanceRecord}. */
export interface ProvenanceMeta {
  /** The emotional tone the user picked, e.g. "Sad" (the 2nd and last user action). */
  emotion?: string;
  /** Language code passed to TTS, e.g. "en-IN", "hi-IN". */
  language?: string;
  /** Sarvam speaker id used. */
  speaker?: string;
  /** How many times the user asked for a fresh set of expression options. */
  regenerateCount?: number;
  /** Whether literal mode (no AI phrasing) produced the final text. */
  usedLiteralMode?: boolean;

  /* ── F-04: what the safety system actually did ──────────────────────────── */

  /** Where the spoken phrasing came from: "model" | "fallback" | "literal". */
  source?: ResultSource;
  /** LLM provider that produced (or failed to produce) the phrasing, e.g. "groq". */
  llmProvider?: string;
  /** LLM model id, e.g. "llama-3.1-8b-instant". */
  llmModel?: string;
  /** Every candidate the fidelity gate rejected for this message. */
  rejectedCandidates?: RejectedCandidate[];
  /** Wall-clock cost of each stage, in milliseconds. */
  latencyMs?: { interpret?: number; generate?: number; tts?: number };
  /**
   * True when the user actively picked the expression option (or hand-edited the
   * text); false when the spoken text was a staged default they never touched
   * (Features.md F-11).
   */
  optionSelectionWasExplicit?: boolean;
  /** App build identifier, for reconstructing behaviour after a deploy. */
  appVersion?: string;
  /** True when playback was interrupted by the user before it finished (F-07). */
  speechCancelled?: boolean;
  /** Set when this record re-speaks an earlier message: the original record id (F-12). */
  repeatOf?: string;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 6. API request / response envelopes  (ADDITIVE — see ../SPEC.md §2)
 * ────────────────────────────────────────────────────────────────────────────
 * These are not in the required type list, but the frontend needs concrete
 * shapes to wire against the stub endpoints today. Keep them thin.
 */

/** Body for `POST /api/interpret`. Response is {@link InterpretationResult}. */
export interface InterpretRequest {
  concepts: Concept[];
  /**
   * ADDITIVE (F-13). Target language code, e.g. "hi-IN". The interpretation is
   * produced *in* this language — generating English and speaking it with a
   * Hindi voice is not Hindi output. Defaults to English when absent.
   */
  language?: string;
}

/** Body for `POST /api/generate-expressions`. */
export interface GenerateExpressionsRequest {
  /** The interpretation text the user confirmed. This is the meaning to preserve. */
  confirmedIntent: string;
  /**
   * Original concepts, passed so the generator can be fidelity-checked against
   * them AND so it can infer which three emotional tones are most plausible.
   */
  concepts: Concept[];
  /** ADDITIVE (F-13). Target language code — expressions are generated in it, not just spoken in it. */
  language?: string;
  /** True when the user rejected the previous set and wants a fresh one. */
  regenerate?: boolean;
  /** Previously shown options, so a regenerate can avoid repeating them. */
  previousOptions?: ExpressionOption[];
}

/** Response for `POST /api/generate-expressions`. Always exactly 3 options. */
export interface GenerateExpressionsResponse {
  options: ExpressionOption[];
  /** ADDITIVE (F-02). Where these options came from. Absent ⇒ "model". */
  source?: ResultSource;
  /** ADDITIVE (F-02). Present only when `source` is not "model". */
  degraded?: DegradedInfo;
  /**
   * ADDITIVE (F-04). Model candidates the fidelity gate rejected. On a fidelity
   * degrade the surviving options are padded with explicit literal renderings
   * rather than silently swapped for template text (F-01, fail-closed).
   */
  rejectedCandidates?: RejectedCandidate[];
  /** ADDITIVE (F-04). LLM provider/model that produced (or failed) this result. */
  llmProvider?: string;
  llmModel?: string;
}

/** Body for `POST /api/tts`. */
export interface TtsRequest {
  /** The exact, user-approved text to synthesize. */
  text: string;
  /** Language code passed straight through to Sarvam, e.g. "en-IN". */
  language: string;
  /** Sarvam speaker id. */
  speaker: string;
  /**
   * Tier this utterance is going out under. Routes the request:
   *  - "full" / "fast" -> Sarvam REST real-time endpoint
   *  - "instant"       -> Sarvam WebSocket streaming endpoint + audio cache
   * (SWARA_KNOWLEDGE.md §13).
   */
  tier: TrustTier;
}

/** Response for `POST /api/tts`. */
export interface TtsResponse {
  /** Base64-encoded audio payload. */
  audioBase64: string;
  /** MIME type of the payload, e.g. "audio/wav". */
  mimeType: string;
  /** True if served from the instant-tier cache rather than a fresh synthesis. */
  cached: boolean;
  /** Which backend produced the audio. "mock" until the Sarvam integration lands. */
  provider: "sarvam-bulbul" | "mock";
}

/** Uniform error body for every endpoint. */
export interface ApiError {
  error: {
    code: string;
    message: string;
    /** Optional machine-readable detail for debugging. Never contains secrets. */
    details?: unknown;
  };
}
