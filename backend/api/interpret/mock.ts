/**
 * Deterministic mock "interpretation intelligence" for the /interpret stub.
 * =======================================================================
 *
 * Replaced wholesale by a real LLM call in the Antigravity pass. Until then this
 * gives the frontend realistic, *stable* responses to wire against — including
 * the ambiguous / ranked-shortlist case (SWARA_KNOWLEDGE.md §9a), which the UI
 * must handle as a first-class state, not an error.
 *
 * It stays honest to the core rule: every generated interpretation string is
 * built only from the concept labels it was given. Nothing invents severity,
 * timeframe, or detail.
 */

import type { Concept, Interpretation, InterpretationResult } from "@swara/shared";
import { INTERPRETATION } from "../../lib/config.ts";
import { conceptCombinationKey } from "../../lib/trust-ladder.ts";

/**
 * A tiny curated table so common demo combinations look sensible. Keys are
 * canonical concept-combination keys (order-independent). Confidence values are
 * hand-set to exercise both the "single answer" and "ranked shortlist" paths.
 */
const CURATED: Record<string, Interpretation[]> = {
  // Clear, dominant reading -> single interpretation.
  "doctor+leg+pain+worse": [
    { text: "Doctor, the pain in my leg is worse.", confidence: 0.92 },
  ],
  "help+now": [{ text: "I need help now.", confidence: 0.95 }],
  "water+want": [{ text: "I would like some water.", confidence: 0.9 }],

  // Genuinely ambiguous -> ranked shortlist, close confidences.
  "cold+feel": [
    { text: "I feel cold.", confidence: 0.55 },
    { text: "I think I am coming down with a cold.", confidence: 0.42 },
  ],
  "tired+you": [
    { text: "I am tired.", confidence: 0.5 },
    { text: "Are you tired?", confidence: 0.4 },
    { text: "I am tired of this.", confidence: 0.3 },
  ],
};

/** Join concept labels into a plain, additive phrase — no invented content. */
function literalJoin(concepts: Concept[]): string {
  return concepts.map((c) => c.label).join(" ");
}

/**
 * Produce a mock {@link InterpretationResult} for the given concepts.
 *
 * Behaviour:
 *  - Known curated combination -> its curated interpretations.
 *  - Otherwise -> one low-ish-confidence literal interpretation, plus a second
 *    "question?" reading when a 2nd-person concept ("you") is present, so the
 *    ambiguous branch is easy to trigger in development.
 *
 * The ranking/threshold logic mirrors what the real implementation should do:
 * trim to a single entry only when the top candidate clears
 * HIGH_CONFIDENCE_THRESHOLD *and* leads by AMBIGUITY_MARGIN.
 */
export function mockInterpret(concepts: Concept[]): InterpretationResult {
  const key = conceptCombinationKey(concepts);
  const curated = CURATED[key];

  const candidates: Interpretation[] = curated
    ? [...curated]
    : buildFallbackCandidates(concepts);

  candidates.sort((a, b) => b.confidence - a.confidence);
  return { concepts, interpretations: rankAndTrim(candidates) };
}

function buildFallbackCandidates(concepts: Concept[]): Interpretation[] {
  const phrase = literalJoin(concepts);
  const out: Interpretation[] = [
    { text: capitalise(`${phrase}.`), confidence: 0.6 },
  ];
  if (concepts.some((c) => c.id === "you" || c.label.toLowerCase() === "you")) {
    out.push({ text: capitalise(`${phrase}?`), confidence: 0.5 });
  }
  return out;
}

/**
 * Apply the config thresholds: keep 1 entry if confident and unambiguous,
 * otherwise return between MIN_RANKED and MAX_RANKED entries.
 */
function rankAndTrim(sorted: Interpretation[]): Interpretation[] {
  const [top, second] = sorted;
  if (!top) return [];
  const unambiguous =
    top.confidence >= INTERPRETATION.HIGH_CONFIDENCE_THRESHOLD &&
    (!second || top.confidence - second.confidence >= INTERPRETATION.AMBIGUITY_MARGIN);

  if (unambiguous) return [top];
  return sorted.slice(0, Math.max(INTERPRETATION.MIN_RANKED, Math.min(INTERPRETATION.MAX_RANKED, sorted.length)));
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}
