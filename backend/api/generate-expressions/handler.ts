/**
 * POST /api/generate-expressions
 * ==============================
 *
 * Input:  { confirmedIntent, concepts, regenerate?, previousOptions? }
 *         (GenerateExpressionsRequest)
 * Output: { options: ExpressionOption[] }   — exactly 3   (GenerateExpressionsResponse)
 *
 * This is step 4 of the core loop and runs ONLY after the user has confirmed the
 * meaning (SWARA_KNOWLEDGE.md §6). The three options are the same confirmed
 * meaning coloured by three different plausible EMOTIONAL TONES (chosen per
 * message from the concepts, not a fixed trio). Each is an AI-suggested reading
 * for the user to pick from — they must not differ in meaning, and none is
 * staged to speak until the user explicitly selects it.
 *
 * STATUS: stub. Deterministic mock data (./mock.ts). The real LLM call lands in
 * the Antigravity pass and must use `buildExpressionPrompt()` from
 * lib/prompts.ts (carries MEANING_FIDELITY_CONSTRAINT).
 *
 * Framework-agnostic async function; server.ts adapts it to Express.
 */

import type {
  Concept,
  ExpressionOption,
  GenerateExpressionsRequest,
  GenerateExpressionsResponse,
} from "@swara/shared";
import { CONFIG } from "../../lib/config.ts";
import { createLlmClient } from "../../lib/llm-client.ts";
import { renderIntentForExpression } from "../../lib/prompts.ts";
import { extractJson } from "../interpret/handler.ts";
import { checkFidelity, partitionByFidelity } from "../../lib/fidelity.ts";
import { renderLiteral } from "../../lib/literal-mode.ts";
import { mockGenerateExpressions } from "./mock.ts";

/** Thrown for malformed input; server.ts maps this to HTTP 400. */
export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRequestError";
  }
}

export function parseGenerateExpressionsRequest(body: unknown): GenerateExpressionsRequest {
  if (typeof body !== "object" || body === null) {
    throw new InvalidRequestError("Body must be a JSON object.");
  }
  const b = body as Record<string, unknown>;

  if (typeof b.confirmedIntent !== "string" || b.confirmedIntent.trim() === "") {
    throw new InvalidRequestError("`confirmedIntent` must be a non-empty string.");
  }
  if (!Array.isArray(b.concepts) || b.concepts.length === 0) {
    throw new InvalidRequestError("`concepts` must be a non-empty array (for fidelity checking).");
  }
  const concepts: Concept[] = b.concepts.map((c, i) => {
    const concept = c as Concept;
    if (
      typeof concept !== "object" ||
      concept === null ||
      typeof concept.id !== "string" ||
      typeof concept.emoji !== "string" ||
      typeof concept.label !== "string"
    ) {
      throw new InvalidRequestError(`concepts[${i}] must be { id, emoji, label } strings.`);
    }
    return { id: concept.id, emoji: concept.emoji, label: concept.label };
  });

  return {
    confirmedIntent: b.confirmedIntent,
    concepts,
    regenerate: b.regenerate === true,
    previousOptions: Array.isArray(b.previousOptions)
      ? (b.previousOptions as GenerateExpressionsRequest["previousOptions"])
      : undefined,
    ...(typeof b.language === "string" && b.language.trim() !== "" ? { language: b.language.trim() } : {}),
  };
}

/**
 * True only if all three options are well-formed AND every one preserves
 * `confirmedIntent` (Features.md F-01 — the parameter that the old implementation
 * accepted but never read). Real meaning-preservation logic lives in
 * `lib/fidelity.ts`.
 */
export function validateExpressionOptionsFidelity(
  options: ExpressionOption[],
  confirmedIntent: string,
  concepts: Concept[],
): boolean {
  if (!Array.isArray(options) || options.length !== 3) {
    return false;
  }
  for (const opt of options) {
    if (typeof opt.emotion !== "string" || opt.emotion.trim() === "") return false;
    if (typeof opt.text !== "string" || opt.text.trim() === "") return false;
    if (!checkFidelity(opt.text, confirmedIntent, concepts).ok) return false;
  }
  return true;
}

/** The three explicit "offline / literal" phrasings used when the model path is unavailable. */
export function literalExpressionOptions(
  confirmedIntent: string,
  concepts: Concept[],
): ExpressionOption[] {
  const literal = renderLiteral(concepts) || confirmedIntent.trim();
  const intent = confirmedIntent.trim();
  // Distinct labels, but every text is a literal reading — no emotional colour
  // we cannot stand behind, so all three are flavours of neutral.
  return [
    { emotion: "Neutral / calm", text: intent || literal },
    { emotion: "Matter-of-fact", text: literal },
    { emotion: "Plain", text: intent || literal },
  ];
}

/** Pad a short option list up to exactly 3 with explicit literal readings (fail-closed, F-01). */
function padWithLiteral(
  survivors: ExpressionOption[],
  confirmedIntent: string,
  concepts: Concept[],
): ExpressionOption[] {
  const out = [...survivors];
  const filler = literalExpressionOptions(confirmedIntent, concepts);
  let i = 0;
  while (out.length < 3 && i < filler.length) {
    const candidate = filler[i++]!;
    if (!out.some((o) => o.text.trim() === candidate.text.trim())) out.push(candidate);
  }
  // Last resort so the "always 3" contract holds even for a 1-word intent.
  while (out.length < 3) out.push({ emotion: "Plain", text: confirmedIntent.trim() });
  return out.slice(0, 3);
}

export async function generateExpressions(
  request: GenerateExpressionsRequest,
): Promise<GenerateExpressionsResponse> {
  const { confirmedIntent, concepts, language } = request;

  // No model configured: the user is looking at template text. Say so (F-02) —
  // do not present it with the same confidence as a real model result.
  if (!CONFIG.llm.enabled) {
    return {
      options: mockGenerateExpressions(confirmedIntent, concepts),
      source: "fallback",
      degraded: {
        reason: "not-configured",
        message: "Offline phrasing — no AI is configured. These are template readings of your confirmed meaning.",
      },
    };
  }

  const llm = createLlmClient();
  const promptUserTurn = [
    renderIntentForExpression(confirmedIntent, concepts, language),
    request.regenerate && request.previousOptions
      ? `\nProduce a FRESH, DIFFERENT set of expressions distinct from previous: ${JSON.stringify(request.previousOptions)}`
      : "",
    "",
    "Format your response strictly as a JSON object matching:",
    "{",
    '  "options": [',
    '    { "emotion": "One plausible emotion for this message", "text": "Expression sentence" },',
    '    { "emotion": "...", "text": "..." },',
    '    { "emotion": "...", "text": "..." }',
    "  ]",
    "}",
    "Rules:",
    "- Produce EXACTLY 3 options.",
    "- Each `emotion` is a FEELING word/phrase (e.g. Sad, Frustrated, Anxious, Tired, Hopeful, Neutral / calm) — never a politeness or formality level like Polite/Formal/Direct/Urgent/Concise. The 3 feelings must be clearly different and chosen for THIS message (not a fixed hardcoded trio). A calm / neutral reading is always allowed.",
    "- Only the emotional colouring changes between the 3. ALL options must strictly convey the confirmed meaning and must NOT invent any facts, severities, timeframes, requests, or unindicated details, and must NOT add a new statement about how the user feels.",
  ].join("\n");

  let provider = CONFIG.llm.provider;
  let model = CONFIG.llm.model;

  try {
    const response = await llm.complete({
      task: "expression",
      messages: [{ role: "user", content: promptUserTurn }],
      temperature: 0.2,
    });
    provider = response.provider || provider;
    model = response.model || model;

    interface ParsedOutput {
      options?: Array<{ emotion?: unknown; text?: unknown }>;
    }

    const parsed = extractJson<ParsedOutput>(response.text);
    if (parsed && Array.isArray(parsed.options) && parsed.options.length >= 3) {
      const candidates: ExpressionOption[] = parsed.options.slice(0, 6).map((item) => ({
        emotion: typeof item.emotion === "string" && item.emotion.trim() !== "" ? item.emotion.trim() : "Neutral / calm",
        text: typeof item.text === "string" ? item.text.trim() : "",
      })).filter((o) => o.text !== "");

      const { accepted, rejected } = partitionByFidelity(candidates, confirmedIntent, concepts, { language });

      if (accepted.length >= 3) {
        return {
          options: accepted.slice(0, 3),
          source: "model",
          llmProvider: provider,
          llmModel: model,
          ...(rejected.length > 0 ? { rejectedCandidates: rejected } : {}),
        };
      }

      // Fail closed (F-01, F-02): the model produced drifted meaning. Do NOT
      // silently swap in template text. Return the survivors, pad to three with
      // explicit literal readings, and tell the user the AI could not produce
      // three safe phrasings. The rejection is a distinct, logged event.
      console.error(
        `[generate-expressions] only ${accepted.length}/${candidates.length} option(s) passed the fidelity gate; rejected:`,
        rejected,
      );
      return {
        options: padWithLiteral(accepted, confirmedIntent, concepts),
        source: "literal",
        degraded: {
          reason: "fidelity",
          message:
            accepted.length === 0
              ? "The AI could not produce a phrasing that safely matched your meaning. These are literal readings of your words."
              : "The AI produced fewer than three safe phrasings. The rest are literal readings of your words.",
        },
        llmProvider: provider,
        llmModel: model,
        rejectedCandidates: rejected,
      };
    }
  } catch (err) {
    console.error("[generate-expressions] LLM call failed or produced invalid output; falling back to mock:", err);
  }

  // The model was unreachable / unparseable — a different event from drift.
  // Template text is acceptable here but must be labelled (F-02).
  return {
    options: mockGenerateExpressions(confirmedIntent, concepts),
    source: "fallback",
    degraded: {
      reason: "unreachable",
      message: "Offline phrasing — the AI could not be reached. These are template readings of your confirmed meaning.",
    },
    llmProvider: provider,
    llmModel: model,
  };
}

