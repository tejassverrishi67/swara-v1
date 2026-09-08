/**
 * Prompt-composition tests.
 *
 * The point of lib/prompts.ts is that the meaning-fidelity rule cannot be
 * silently dropped from one prompt while the other is edited. These tests are
 * that guarantee: if a future edit removes the shared constraint from either
 * composed prompt, CI goes red.
 */

import { describe, it, expect } from "vitest";
import {
  MEANING_FIDELITY_CONSTRAINT,
  buildInterpretationPrompt,
  buildExpressionPrompt,
} from "./prompts.ts";

describe("MEANING_FIDELITY_CONSTRAINT", () => {
  it("names the categories SWARA_KNOWLEDGE.md §7/§8 call out", () => {
    const text = MEANING_FIDELITY_CONSTRAINT.toLowerCase();
    for (const term of ["fact", "detail", "severity", "timeframe", "quantit", "cause"]) {
      expect(text).toContain(term);
    }
  });

  it("forbids inventing information", () => {
    expect(MEANING_FIDELITY_CONSTRAINT).toMatch(/must not\b.*\binvent|not\b.*\binvent/i);
  });
});

describe("composed prompts", () => {
  it("the interpretation prompt embeds the constraint verbatim", () => {
    expect(buildInterpretationPrompt()).toContain(MEANING_FIDELITY_CONSTRAINT);
  });

  it("the expression prompt embeds the constraint verbatim", () => {
    expect(buildExpressionPrompt()).toContain(MEANING_FIDELITY_CONSTRAINT);
  });

  it("the interpretation prompt asks for a ranked shortlist when ambiguous", () => {
    expect(buildInterpretationPrompt().toLowerCase()).toMatch(/rank|candidates?/);
  });

  it("the expression prompt asks for 3 per-message emotions, not a fixed trio", () => {
    const p = buildExpressionPrompt().toLowerCase();
    expect(p).toContain("emotion");
    expect(p).toMatch(/not .*fixed hardcoded trio|pick per message/);
    expect(p).toMatch(/clearly different from each other/);
    expect(buildExpressionPrompt()).toMatch(/exactly 3 options/i);
  });
});
