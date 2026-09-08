/**
 * System prompt templates for interpretation and expression generation.
 * =====================================================================
 *
 * ADDED beyond the file list in the architecture brief (see SPEC.md §2/§3c for
 * the rationale). Both LLM-facing prompts are built here from a single shared
 * fragment, {@link MEANING_FIDELITY_CONSTRAINT}, so the non-negotiable "do not
 * invent anything" rule (SWARA_KNOWLEDGE.md §7, §8) is physically impossible to
 * drop from one prompt while editing the other. `prompts.test.ts` asserts that
 * both composed prompts contain it verbatim.
 *
 * These are stubs in the sense that they have not been iterated against a real
 * model's behaviour — but the constraint text itself is intended to survive into
 * production essentially unchanged.
 */

import type { Concept } from "@swara/shared";
import { isSupportedLanguage, languageName } from "./voices.ts";

/**
 * A directive appended to the user turn when a non-English target language is
 * chosen (Features.md F-13). It steers *language*, never content — the fidelity
 * constraint still governs meaning.
 */
export function languageDirective(language: string | undefined): string {
  if (!language || !isSupportedLanguage(language) || language.startsWith("en")) return "";
  return `\n\nWrite your entire response in ${languageName(language)} (language code ${language}). Use natural, everyday ${languageName(language)} — not a word-for-word translation. The JSON keys stay in English; only the human-readable text values are in ${languageName(language)}.`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The one rule that must never be lost
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Shared, verbatim in every prompt that turns concepts or intent into language.
 * If you edit this, you are changing the core safety property of the product —
 * do it deliberately and update SPEC.md.
 */
export const MEANING_FIDELITY_CONSTRAINT = [
  "ABSOLUTE CONSTRAINT — MEANING FIDELITY (never override this):",
  "",
  "You must NOT invent, add, assume, imply, or infer ANY information that is not",
  "directly present in the user's selected concepts. This specifically includes,",
  "but is not limited to:",
  "  - facts or events the user did not indicate;",
  "  - specific details (body parts, people, places, objects) not selected;",
  "  - severity or intensity (\"severe\", \"a little\", \"unbearable\") not selected;",
  "  - timeframes, durations, frequencies, or dates (\"for three weeks\",",
  "    \"since yesterday\", \"often\") not selected;",
  "  - quantities, measurements, or numbers not selected;",
  "  - causes, diagnoses, or explanations not selected;",
  "  - requests, needs, or intentions (\"I need medication\") not selected.",
  "",
  "If the concepts are sparse or ambiguous, your output must stay correspondingly",
  "sparse or general. It is correct and expected to produce a short, vague, or",
  "incomplete sentence when the concepts are short, vague, or incomplete. Do not",
  "\"help\" by filling gaps. Changing wording is allowed; changing, sharpening, or",
  "extending meaning is not.",
  "",
  "Example of a FORBIDDEN completion: concepts [doctor, headache, worse] ->",
  "\"Doctor, I've had severe headaches for three weeks and need stronger",
  "medication.\" (severity, timeframe, and request were all invented.)",
  "Acceptable: \"Doctor, my headache is worse.\"",
].join("\n");

/* ────────────────────────────────────────────────────────────────────────────
 * Interpretation prompt
 * ──────────────────────────────────────────────────────────────────────────── */

export const INTERPRETATION_ROLE = [
  "You are SWARA's interpretation module. SWARA is an assistive communication",
  "(AAC) tool for people who cannot reliably produce speech — stroke/aphasia",
  "survivors, laryngectomy patients, and others.",
  "",
  "The user has selected a small set of concept tiles (emoji + label). Your job",
  "is to state, in plain language, what those concepts most likely mean as a",
  "message the user wants to communicate. When the concepts plausibly support",
  "more than one distinct reading, return a short ranked list of candidates",
  "(most likely first) instead of forcing a single guess — the user will pick",
  "or add another concept to disambiguate.",
  "",
  "Output requirements:",
  "  - 1 candidate when one reading is clearly dominant; otherwise 2-3.",
  "  - Each candidate: one short, natural sentence in the first person.",
  "  - Rank by likelihood. Do not editorialise or add politeness/tone here —",
  "    that happens in a later step.",
].join("\n");

/** Build the full interpretation system prompt (role + the fidelity constraint). */
export function buildInterpretationPrompt(): string {
  return `${INTERPRETATION_ROLE}\n\n${MEANING_FIDELITY_CONSTRAINT}`;
}

/** Render the selected concepts as the user turn that accompanies the prompt above. */
export function renderConceptsForInterpretation(concepts: Concept[], language?: string): string {
  const lines = concepts.map((c) => `- ${c.emoji} ${c.label} (id: ${c.id})`);
  return `Selected concepts (unordered):\n${lines.join("\n")}${languageDirective(language)}`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Expression-generation prompt
 * ──────────────────────────────────────────────────────────────────────────── */

export const EXPRESSION_ROLE = [
  "You are SWARA's expression module. The user has ALREADY confirmed exactly what",
  "they mean. Your job is to offer three ways to SAY that same confirmed meaning,",
  "each coloured by a different plausible EMOTIONAL TONE, so the user can pick the",
  "one that matches how they actually feel.",
  "",
  "Rules:",
  "  - Produce EXACTLY 3 options.",
  "  - Look at the confirmed meaning and the selected concepts and choose the 3",
  "    most plausible FEELINGS for THIS message. Each label is an emotion word or",
  "    short emotion phrase — e.g. \"Sad\", \"Frustrated\", \"Neutral / calm\",",
  "    \"Anxious\", \"Tired\", \"In pain\", \"Hopeful\", \"Embarrassed\", \"Angry\",",
  "    \"Scared\", \"Grateful\", \"Relieved\".",
  "  - The label is a FEELING, never a politeness or formality level. Do NOT use",
  "    \"Polite\", \"Formal\", \"Direct\", \"Casual\", \"Urgent\", \"Concise\", or any",
  "    register/audience descriptor.",
  "  - The 3 feelings must be clearly different from each other. Do NOT reuse a",
  "    fixed hardcoded trio every time — pick per message. A calm / neutral",
  "    reading is always an allowed option.",
  "  - Only the emotional colouring and phrasing may change between the 3. The",
  "    facts, requests, details, severity, timeframe, and everything else in the",
  "    confirmed meaning stay identical in all 3. Convey the feeling through word",
  "    choice and rhythm, NOT by adding a new statement about the user's state.",
  "  - The emotion labels are SUGGESTIONS for the user to choose from — you are",
  "    NOT asserting how the user feels.",
].join("\n");

/** Build the full expression-generation system prompt (role + the fidelity constraint). */
export function buildExpressionPrompt(): string {
  return `${EXPRESSION_ROLE}\n\n${MEANING_FIDELITY_CONSTRAINT}`;
}

/** Render the confirmed intent + original concepts as the accompanying user turn. */
export function renderIntentForExpression(
  confirmedIntent: string,
  concepts: Concept[],
  language?: string,
): string {
  const conceptLine = concepts.map((c) => `${c.emoji} ${c.label}`).join(", ");
  return [
    `Confirmed meaning (preserve exactly): "${confirmedIntent}"`,
    `Original concepts, for fidelity checking and for judging plausible emotions: ${conceptLine}`,
  ].join("\n") + languageDirective(language);
}
