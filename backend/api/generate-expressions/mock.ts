/**
 * Deterministic mock for the /generate-expressions stub.
 * =====================================================
 *
 * Replaced by a real LLM call in the Antigravity pass.
 *
 * Two things this mock is careful to demonstrate correctly, because they are
 * product-critical and easy to get wrong later:
 *
 *  1. **The 3 options are 3 emotional tones, not audience phrasings, and the
 *     trio is not fixed.** Which emotions come back depends on the selected
 *     concepts (see `EMOTION_CUES`); there is no hardcoded `["Sad","Angry",
 *     "Calm"]` constant.
 *
 *  2. **Meaning is preserved exactly.** Every option is the confirmed intent
 *     with only a meaning-neutral framing particle added (all drawn from the
 *     fidelity gate's FRAMING_ALLOWLIST). The emotion is a *label the user may
 *     choose*, never an asserted fact — the mock adds no severity, urgency,
 *     detail, or claim about the user's state.
 */

import type { Concept, ExpressionOption } from "@swara/shared";

/**
 * Emotion → the concept ids/labels that make it a plausible reading. Order here
 * is the tie-break order, but the actual trio is driven by which cues the
 * selected concepts hit, so it varies from message to message.
 */
const EMOTION_CUES: Array<{ emotion: string; cue: RegExp }> = [
  { emotion: "Sad", cue: /\b(sad|cry|hurt|pain|sore|miss|lonely|loss|down)\b/ },
  { emotion: "Frustrated", cue: /\b(frustrat|annoyed?|again|still|stuck|angry|no|stop)\b/ },
  { emotion: "Anxious", cue: /\b(help|scared|afraid|worry|worried|nervous|panic|emergency|sos)\b/ },
  { emotion: "Tired", cue: /\b(tired|exhaust|sleep|rest|weak|fatigue)\b/ },
  { emotion: "In pain", cue: /\b(pain|hurt|ache|head|leg|arm|back|chest|stomach|cramp)\b/ },
  { emotion: "Hopeful", cue: /\b(better|hope|soon|improv|thank|please|happy)\b/ },
  { emotion: "Embarrassed", cue: /\b(sorry|embarrass|toilet|bathroom|accident)\b/ },
  { emotion: "Grateful", cue: /\b(thank|grateful|appreciate|kind)\b/ },
];

/** Fallback readings, always available so slot 3 never forces an unsupported emotion. */
const NEUTRAL_EMOTIONS = ["Neutral / calm", "Matter-of-fact", "Plain"];

/**
 * Positional framing particles — one per slot, every one on the fidelity gate's
 * FRAMING_ALLOWLIST, so the three option texts are visibly distinct without
 * adding meaning.
 */
const SLOT_FRAMES: Array<(intent: string) => string> = [
  (i) => i,
  (i) => `Honestly, ${lower(i)}`,
  (i) => `Well, ${lower(i)}`,
];

/** Build exactly three emotional-tone options for a confirmed intent + concepts. */
export function mockGenerateExpressions(
  confirmedIntent: string,
  concepts: Concept[],
): ExpressionOption[] {
  const intent = normalisePunctuation(confirmedIntent.trim());
  const haystack = concepts
    .map((c) => `${c.id} ${c.label}`)
    .concat(confirmedIntent)
    .join(" ")
    .toLowerCase();

  const emotions: string[] = [];
  for (const { emotion, cue } of EMOTION_CUES) {
    if (emotions.length === 3) break;
    if (cue.test(haystack) && !emotions.includes(emotion)) emotions.push(emotion);
  }
  for (const filler of NEUTRAL_EMOTIONS) {
    if (emotions.length === 3) break;
    if (!emotions.includes(filler)) emotions.push(filler);
  }

  return emotions.slice(0, 3).map((emotion, i) => ({
    emotion,
    text: normalisePunctuation(SLOT_FRAMES[i]!(intent)),
  }));
}

/* -- meaning-neutral text helpers ----------------------------------------- */

function lower(s: string): string {
  return s.length === 0 ? s : s[0]!.toLowerCase() + s.slice(1);
}

function normalisePunctuation(s: string): string {
  let out = s.trim().replace(/\s+/g, " ");
  if (out.length > 0 && !/[.!?]$/.test(out)) out += ".";
  return out;
}
