/**
 * POST /api/interpret
 * ===================
 *
 * Input:  { concepts: Concept[] }                 (InterpretRequest)
 * Output: InterpretationResult                    (1 interpretation if confident,
 *                                                  2-3 ranked if ambiguous)
 *
 * STATUS: stub. Returns deterministic mock data (./mock.ts) so the frontend can
 * be wired against it now. The real LLM call lands in the Antigravity pass and
 * must use `buildInterpretationPrompt()` from lib/prompts.ts (which carries
 * MEANING_FIDELITY_CONSTRAINT) — do not hand-roll a prompt here.
 *
 * The handler is written framework-agnostic (plain async function, validated
 * input, typed output). server.ts adapts it to Express; a serverless/Next.js
 * route could adapt the same function unchanged.
 */

import type { Concept, Interpretation, InterpretRequest, InterpretationResult } from "@swara/shared";
import { CONFIG, INTERPRETATION } from "../../lib/config.ts";
import { createLlmClient } from "../../lib/llm-client.ts";
import { renderConceptsForInterpretation } from "../../lib/prompts.ts";
import { checkFidelity, fidelityReason } from "../../lib/fidelity.ts";
import { mockInterpret } from "./mock.ts";

/** Thrown for malformed input; server.ts maps this to HTTP 400. */
export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRequestError";
  }
}

/** Narrow unknown JSON into a validated {@link InterpretRequest}. */
export function parseInterpretRequest(body: unknown): InterpretRequest {
  if (typeof body !== "object" || body === null || !("concepts" in body)) {
    throw new InvalidRequestError("Body must be an object with a `concepts` array.");
  }
  const { concepts } = body as { concepts: unknown };
  if (!Array.isArray(concepts) || concepts.length === 0) {
    throw new InvalidRequestError("`concepts` must be a non-empty array.");
  }
  const parsed: Concept[] = concepts.map((c, i) => {
    if (
      typeof c !== "object" ||
      c === null ||
      typeof (c as Concept).id !== "string" ||
      typeof (c as Concept).emoji !== "string" ||
      typeof (c as Concept).label !== "string"
    ) {
      throw new InvalidRequestError(`concepts[${i}] must be { id, emoji, label } strings.`);
    }
    const concept = c as Concept;
    return { id: concept.id, emoji: concept.emoji, label: concept.label };
  });
  const language = (body as { language?: unknown }).language;
  return {
    concepts: parsed,
    ...(typeof language === "string" && language.trim() !== "" ? { language: language.trim() } : {}),
  };
}

/** Extract JSON safely from raw LLM completion (handles markdown code blocks and raw JSON). */
export function extractJson<T>(raw: string): T | null {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const jsonBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonBlock?.[1]) {
      try {
        return JSON.parse(jsonBlock[1].trim()) as T;
      } catch {
        // continue
      }
    }
    const objectMatch = trimmed.match(/\{[\s\S]*\}/);
    if (objectMatch?.[0]) {
      try {
        return JSON.parse(objectMatch[0].trim()) as T;
      } catch {
        // continue
      }
    }
    return null;
  }
}

/**
 * Fidelity check for a single interpretation candidate.
 *
 * Back-compat shim: the real engine now lives in `lib/fidelity.ts` and is shared
 * with /generate-expressions so the two paths cannot drift (Features.md F-01,
 * F-20). Interpretation has no separately-confirmed intent to anchor against —
 * the concepts *are* the meaning — so this runs the claim-diff layer (invented
 * severity / timeframe / frequency / quantity / cause / request / negation)
 * against the concept labels and skips the "added detail" noun check.
 */
export function isFidelityCompliant(text: string, concepts: Concept[]): boolean {
  const pseudoIntent = concepts.map((c) => c.label).join(" ");
  return checkFidelity(text, pseudoIntent, concepts, { anchorCheck: false }).ok;
}

/**
 * Apply the config thresholds: keep 1 entry if confident and unambiguous,
 * otherwise return between MIN_RANKED and MAX_RANKED entries.
 */
export function rankAndTrimInterpretations(candidates: Interpretation[]): Interpretation[] {
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const [top, second] = sorted;
  if (!top) return [];

  const unambiguous =
    top.confidence >= INTERPRETATION.HIGH_CONFIDENCE_THRESHOLD &&
    (!second || top.confidence - second.confidence >= INTERPRETATION.AMBIGUITY_MARGIN);

  if (unambiguous) {
    return [top];
  }

  const count = Math.max(
    INTERPRETATION.MIN_RANKED,
    Math.min(INTERPRETATION.MAX_RANKED, sorted.length),
  );
  return sorted.slice(0, count);
}

/**
 * Core handler. If a real LLM is configured via CONFIG.llm, queries the model
 * with MEANING_FIDELITY_CONSTRAINT. Otherwise uses deterministic mockInterpret.
 *
 * Honest degradation (Features.md F-02): the result carries `source` and, when it
 * is not a fresh model answer, a plain `degraded.message` the UI can show. It
 * never silently substitutes template text with the same confidence as a real
 * interpretation.
 */
export async function interpret(request: InterpretRequest): Promise<InterpretationResult> {
  const { concepts, language } = request;

  if (!CONFIG.llm.enabled) {
    return {
      ...mockInterpret(concepts),
      source: "fallback",
      degraded: {
        reason: "not-configured",
        message: "Offline phrasing — no AI interpreter is configured. This is a literal reading of your concepts.",
      },
    };
  }

  const llm = createLlmClient();
  const promptUserTurn = [
    renderConceptsForInterpretation(concepts, language),
    "",
    "Format your output strictly as a JSON object with schema:",
    "{",
    '  "interpretations": [',
    '    { "text": "...", "confidence": 0.95 }',
    "  ]",
    "}",
    "Return 1 interpretation if one meaning clearly dominates, or 2 to 3 ranked candidates if ambiguous.",
    "Confidence must be a number between 0 and 1.",
  ].join("\n");

  const rejectedCandidates: Array<{ text: string; reason: string }> = [];
  let provider = CONFIG.llm.provider;
  let model = CONFIG.llm.model;

  try {
    const response = await llm.complete({
      task: "interpretation",
      messages: [{ role: "user", content: promptUserTurn }],
      temperature: 0.1,
    });
    provider = response.provider || provider;
    model = response.model || model;

    interface ParsedOutput {
      interpretations?: Array<{ text?: unknown; confidence?: unknown }>;
    }

    const parsed = extractJson<ParsedOutput>(response.text);
    if (parsed && Array.isArray(parsed.interpretations) && parsed.interpretations.length > 0) {
      const validCandidates: Interpretation[] = [];
      for (const item of parsed.interpretations) {
        if (typeof item.text === "string" && item.text.trim() !== "") {
          const confidence =
            typeof item.confidence === "number" && !isNaN(item.confidence)
              ? Math.max(0, Math.min(1, item.confidence))
              : 0.7;
          const cleanText = item.text.trim();
          const check = checkFidelity(
            cleanText,
            concepts.map((c) => c.label).join(" "),
            concepts,
            { anchorCheck: false, language },
          );
          if (check.ok) validCandidates.push({ text: cleanText, confidence });
          else rejectedCandidates.push({ text: cleanText, reason: fidelityReason(check) });
        }
      }

      if (validCandidates.length > 0) {
        return {
          concepts,
          interpretations: rankAndTrimInterpretations(validCandidates),
          source: "model",
          llmProvider: provider,
          llmModel: model,
          ...(rejectedCandidates.length > 0 ? { rejectedCandidates } : {}),
        };
      }

      // The model answered but every candidate drifted. This is a louder event
      // than "unreachable" — surface it distinctly (F-02) and do not pretend the
      // template is the model's reading.
      console.error(
        `[interpret] all ${rejectedCandidates.length} model candidate(s) failed the fidelity gate:`,
        rejectedCandidates,
      );
      return {
        ...mockInterpret(concepts),
        source: "fallback",
        degraded: {
          reason: "fidelity",
          message:
            "The AI's reading did not safely match your concepts, so it was discarded. This is a literal reading instead.",
        },
        llmProvider: provider,
        llmModel: model,
        rejectedCandidates,
      };
    }
  } catch (err) {
    console.error("[interpret] LLM call failed or produced invalid output; falling back to mock:", err);
  }

  return {
    ...mockInterpret(concepts),
    source: "fallback",
    degraded: {
      reason: "unreachable",
      message: "Offline phrasing — the AI could not be reached. This is a literal reading of your concepts.",
    },
    llmProvider: provider,
    llmModel: model,
    ...(rejectedCandidates.length > 0 ? { rejectedCandidates } : {}),
  };
}

