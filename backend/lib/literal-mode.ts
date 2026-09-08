/**
 * Literal mode
 * ============
 *
 * The fallback for when the user does not want AI phrasing at all — a plain,
 * non-creative rendering of the selected concepts (SWARA_KNOWLEDGE.md §6.8).
 *
 * ADDED beyond the architecture brief's file list (see SPEC.md §3). It lives
 * here, not behind an LLM, precisely because it must be deterministic and
 * involve zero generation: it is the escape hatch from generation. Pure, no I/O.
 *
 * The frontend can call this directly; there is no dedicated endpoint (nothing
 * to proxy, no secret involved).
 */

import type { Concept } from "@swara/shared";

/**
 * Render concepts as a bare, readable string: the labels, in the order selected,
 * space-joined, first letter capitalised, trailing period. Nothing is added,
 * reordered for grammar, or inferred.
 *
 *   [doctor, leg, pain, worse] -> "Doctor leg pain worse."
 */
export function renderLiteral(concepts: Concept[]): string {
  const words = concepts.map((c) => c.label.trim()).filter((w) => w.length > 0);
  if (words.length === 0) return "";
  const joined = words.join(" ");
  return `${joined[0]!.toUpperCase()}${joined.slice(1)}.`;
}
