/**
 * Session flow — the core interaction loop as an explicit state machine.
 * =====================================================================
 *
 * The loop is deliberately just TWO user actions:
 *
 *   1. pick concept tiles          (state: `selecting`)
 *   2. pick one of the suggested   (event: `CHOOSE_EMOTION`)
 *      emotional tones
 *
 *   selecting ──CHOOSE_EMOTION──▶ previewing ──PREVIEW_DONE──▶ speaking ──▶ spoken
 *
 * Everything between — deriving the sentence, running the meaning-fidelity gate —
 * happens invisibly on the backend while the user is still in `selecting`
 * (`SUBMIT` kicks it off; `EMOTIONS_READY` delivers the 3 fidelity-checked
 * emotion options). `previewing` is a brief, non-interactive flash of the exact
 * sentence about to be spoken.
 *
 * The Trust Ladder tier no longer changes *whether* there is a checkpoint; it
 * changes how many emotion options are shown (full=3, fast=2) and whether
 * emotion selection is skipped entirely for a user-pinned `instant` phrase.
 *
 * SAFETY INVARIANTS (asserted by session-flow.test.ts):
 *   1. `speaking` is entered ONLY via `previewing`, which is entered ONLY by an
 *      explicit `CHOOSE_EMOTION`, OR directly from `selecting` for a pinned
 *      instant phrase. There is no other path.
 *   2. Entering `spoken` always writes a ProvenanceRecord (App side), every tier.
 *   3. Nothing in the reducer ever produces `tier: "instant"` — only `SET_TIER`
 *      (driven by an explicit user pin) does.
 */

import type {
  Concept,
  DegradedInfo,
  ExpressionOption,
  Interpretation,
  RejectedCandidate,
  ResultSource,
  TrustTier,
} from "@swara/shared";

/** What produced the current emotion options (Features.md F-02 / F-04). */
export interface ExpressionsMeta {
  source?: ResultSource;
  degraded?: DegradedInfo;
  rejectedCandidates?: RejectedCandidate[];
  llmProvider?: string;
  llmModel?: string;
}

/* ────────────────────────────────────────────────────────────────────────────
 * States
 * ──────────────────────────────────────────────────────────────────────────── */

export type FlowState =
  | "selecting" // picking concept tiles; also where the silent interpret+generate runs
  | "previewing" // brief non-interactive flash of the sentence about to be spoken
  | "speaking" // POST /api/tts + playback
  | "spoken"; // done; provenance written

/* ────────────────────────────────────────────────────────────────────────────
 * Context
 * ──────────────────────────────────────────────────────────────────────────── */

export interface FlowContext {
  state: FlowState;

  /** Language + speaker passed through to TTS. */
  language: string;
  speaker: string;

  /** Concepts selected so far (order = selection order). */
  selectedConcepts: Concept[];

  /** Tier resolved from the Trust Ladder for the current concept set. */
  tier: TrustTier;

  /**
   * The 3 pre-generated, fidelity-checked emotion options (each `{emotion,
   * text}`). The UI shows `slice(0, tier === "fast" ? 2 : 3)` of them as tags.
   */
  emotionOptions?: ExpressionOption[];
  /** Provenance-bearing context about how those options were produced (F-02/F-04). */
  expressionsMeta?: ExpressionsMeta;
  /** The AI's reading(s), logged for audit (no user-facing Meaning Check any more). */
  interpretationsShown?: Interpretation[];
  /** The top interpretation text — stable across emotion choices; drives Trust Ladder promotion. */
  interpretationText?: string;

  /** The emotion the user tapped. */
  chosenEmotion?: string;
  /** The exact sentence staged to be spoken (chosen option's text, or a pinned phrase). */
  stagedText?: string;

  /** True when the user interrupted playback with STOP (F-07). */
  wasCancelled: boolean;

  /** Populated on error so the UI can show it without leaving the flow. */
  error?: string;
}

export function initialFlowContext(params: { language: string; speaker: string }): FlowContext {
  return {
    state: "selecting",
    language: params.language,
    speaker: params.speaker,
    selectedConcepts: [],
    tier: "full",
    wasCancelled: false,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Persistence (Features.md F-08)
 * ────────────────────────────────────────────────────────────────────────────
 * Composing a message costs real physical effort for this audience, so losing a
 * half-composed thought to a refresh / tab crash / device sleep is a big deal.
 * We persist just enough context to offer the thought back — and DELIBERATELY
 * never enough to restore straight into a speakable state.
 */

export interface PersistedSession {
  language: string;
  speaker: string;
  selectedConcepts: Concept[];
  stagedText?: string;
  /** Wall-clock time the snapshot was taken, for a "you were in the middle of…" prompt. */
  savedAt: string;
}

/** Extract the persistable slice of the flow context. */
export function persistableSnapshot(context: FlowContext): PersistedSession {
  return {
    language: context.language,
    speaker: context.speaker,
    selectedConcepts: context.selectedConcepts,
    stagedText: context.stagedText,
    savedAt: new Date().toISOString(),
  };
}

/**
 * Rebuild an initial context from a snapshot. The machine always starts in
 * `selecting` — never `previewing`/`speaking` — so a restored session must pass
 * back through emotion selection before anything can be spoken. `stagedText` is
 * intentionally NOT restored; only language/speaker and the in-progress concept
 * selection come back.
 */
export function restoreFlowContext(snapshot: PersistedSession): FlowContext {
  return {
    ...initialFlowContext({ language: snapshot.language, speaker: snapshot.speaker }),
    selectedConcepts: snapshot.selectedConcepts ?? [],
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Events
 * ──────────────────────────────────────────────────────────────────────────── */

export type FlowEvent =
  | { type: "TOGGLE_CONCEPT"; concept: Concept }
  | { type: "SET_LANGUAGE"; language: string } // F-13
  | { type: "SET_SPEAKER"; speaker: string } // F-14
  | { type: "SET_TIER"; tier: TrustTier; pinnedText?: string }
  | { type: "SUBMIT" } // kick off the silent interpret+generate (or, for a pinned instant phrase, go straight to previewing)
  | {
      type: "EMOTIONS_READY";
      options: ExpressionOption[];
      interpretationText: string;
      interpretationsShown: Interpretation[];
      meta?: ExpressionsMeta;
    }
  | { type: "CHOOSE_EMOTION"; option: ExpressionOption } // the 2nd (and last) user action -> previewing
  | { type: "PREVIEW_DONE" } // the flash timer elapsed -> speaking
  | { type: "SPEECH_DONE" } // -> spoken (+ provenance write)
  | { type: "SPEECH_CANCELLED" } // user hit STOP mid-flash/playback (F-07) -> spoken, cut short
  | { type: "ERROR"; message: string }
  | { type: "HYDRATE"; snapshot: PersistedSession } // F-08
  | { type: "RESET" };

/* ────────────────────────────────────────────────────────────────────────────
 * Reducer
 * ──────────────────────────────────────────────────────────────────────────── */

/** Clears every derived field so a concept/language change cannot leave stale suggestions. */
function clearedDerivedState(context: FlowContext): FlowContext {
  return {
    ...context,
    emotionOptions: undefined,
    expressionsMeta: undefined,
    interpretationsShown: undefined,
    interpretationText: undefined,
    chosenEmotion: undefined,
    stagedText: undefined,
    wasCancelled: false,
    state: "selecting",
    error: undefined,
  };
}

export function flowReducer(context: FlowContext, event: FlowEvent): FlowContext {
  switch (event.type) {
    case "TOGGLE_CONCEPT": {
      const exists = context.selectedConcepts.some((c) => c.id === event.concept.id);
      const nextConcepts = exists
        ? context.selectedConcepts.filter((c) => c.id !== event.concept.id)
        : [...context.selectedConcepts, event.concept];
      return {
        ...clearedDerivedState(context),
        selectedConcepts: nextConcepts,
        // `tier` is a property of one specific concept combination; the moment the
        // selection changes it is unknown again and the safe default is "full".
        // App re-fetches the real tier from the backend on selection change.
        tier: "full",
      };
    }

    case "SET_LANGUAGE":
      // Language feeds interpretation + expression prompts, not just TTS (F-13).
      if (event.language === context.language) return context;
      return { ...clearedDerivedState(context), language: event.language };

    case "SET_SPEAKER":
      return { ...context, speaker: event.speaker };

    case "SET_TIER":
      return {
        ...context,
        tier: event.tier,
        stagedText:
          event.tier === "instant" && event.pinnedText ? event.pinnedText : context.stagedText,
      };

    case "SUBMIT": {
      if (context.selectedConcepts.length === 0) return context;
      // Pinned instant phrase: no interpret/generate, straight to the flash.
      if (context.tier === "instant" && context.stagedText) {
        return { ...context, state: "previewing", wasCancelled: false, error: undefined };
      }
      // Otherwise stay in `selecting`; App runs the silent calls and dispatches
      // EMOTIONS_READY. A `loading` flag (App-side) drives the "thinking" UI.
      return { ...context, error: undefined };
    }

    case "EMOTIONS_READY":
      return {
        ...context,
        state: "selecting",
        emotionOptions: event.options,
        interpretationText: event.interpretationText,
        interpretationsShown: event.interpretationsShown,
        expressionsMeta: event.meta,
        chosenEmotion: undefined,
        stagedText: undefined,
        error: undefined,
      };

    case "CHOOSE_EMOTION":
      return {
        ...context,
        state: "previewing",
        chosenEmotion: event.option.emotion,
        stagedText: event.option.text,
        wasCancelled: false,
        error: undefined,
      };

    case "PREVIEW_DONE":
      if (context.state !== "previewing" || !context.stagedText) return context;
      return { ...context, state: "speaking", error: undefined };

    case "SPEECH_DONE":
      return { ...context, state: "spoken", wasCancelled: false, error: undefined };

    case "SPEECH_CANCELLED":
      // Only meaningful mid-flash / mid-playback. The message still lands in
      // `spoken` (and still gets a provenance record) flagged as cut short (F-07).
      if (context.state !== "previewing" && context.state !== "speaking") return context;
      return { ...context, state: "spoken", wasCancelled: true, error: undefined };

    case "ERROR":
      return {
        ...context,
        error: event.message,
        // Fall back to the only interactive state there is.
        state: "selecting",
      };

    case "HYDRATE":
      return restoreFlowContext(event.snapshot);

    case "RESET":
      return initialFlowContext(context);

    default:
      return context;
  }
}

/** Guard used by the UI and asserted by tests: is it legal to speak right now? */
export function canSpeak(context: FlowContext): boolean {
  // Post-emotion-pick path: the flash has committed us and a sentence is staged.
  if (
    (context.state === "previewing" || context.state === "speaking") &&
    !!context.stagedText
  ) {
    return true;
  }
  // Pinned instant path: instant tier with a staged pinned phrase straight from selection.
  if (context.tier === "instant" && context.state === "selecting" && !!context.stagedText) {
    return true;
  }
  return false;
}
