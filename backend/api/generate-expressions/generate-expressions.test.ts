import { describe, expect, it } from "vitest";
import type { Concept, ExpressionOption } from "@swara/shared";
import {
  generateExpressions,
  parseGenerateExpressionsRequest,
  validateExpressionOptionsFidelity,
  InvalidRequestError,
} from "./handler.ts";

describe("api/generate-expressions handler", () => {
  const concepts: Concept[] = [
    { id: "leg", emoji: "🦵", label: "leg" },
    { id: "pain", emoji: "😣", label: "pain" },
  ];
  const confirmedIntent = "My leg hurts.";

  it("produces exactly 3 emotion-labelled options", async () => {
    const res = await generateExpressions({ confirmedIntent, concepts });

    expect(res.options).toHaveLength(3);
    for (const opt of res.options) {
      expect(opt.emotion.trim().length).toBeGreaterThan(0);
      expect(opt.text.trim().length).toBeGreaterThan(0);
    }
  });

  it("labels each option with a distinct emotion, and the trio varies with the concepts", async () => {
    const painful = await generateExpressions({ confirmedIntent, concepts });
    const calm = await generateExpressions({
      confirmedIntent: "I want water.",
      concepts: [{ id: "water", emoji: "💧", label: "water" }],
    });

    const painEmotions = painful.options.map((o) => o.emotion);
    const calmEmotions = calm.options.map((o) => o.emotion);

    // 3 distinct emotions within a message, and distinct option texts so each
    // card is individually selectable.
    expect(new Set(painEmotions).size).toBe(3);
    expect(new Set(painful.options.map((o) => o.text)).size).toBe(3);
    // Different concepts → a different set of emotions (not a fixed trio).
    expect(painEmotions).not.toEqual(calmEmotions);
  });

  it("validates fidelity of generated expressions (all 3 must preserve meaning)", () => {
    const validOptions: ExpressionOption[] = [
      { emotion: "Neutral / calm", text: "My leg hurts." },
      { emotion: "Sad", text: "Doctor, my leg hurts." },
      { emotion: "In pain", text: "Leg pain." },
    ];
    expect(validateExpressionOptionsFidelity(validOptions, confirmedIntent, concepts)).toBe(true);

    // Emotional colouring may not smuggle in severity the confirmed meaning lacks.
    const invalidSeverities: ExpressionOption[] = [
      { emotion: "Distraught", text: "I have excruciating severe leg pain." },
      { emotion: "Sad", text: "Doctor, my leg hurts." },
      { emotion: "In pain", text: "Leg pain." },
    ];
    expect(validateExpressionOptionsFidelity(invalidSeverities, confirmedIntent, concepts)).toBe(false);

    const wrongCount: ExpressionOption[] = [{ emotion: "Sad", text: "My leg hurts." }];
    expect(validateExpressionOptionsFidelity(wrongCount, confirmedIntent, concepts)).toBe(false);
  });

  it("rejects invalid request payloads", () => {
    expect(() => parseGenerateExpressionsRequest(null)).toThrow(InvalidRequestError);
    expect(() =>
      parseGenerateExpressionsRequest({ confirmedIntent: "", concepts: [] }),
    ).toThrow(InvalidRequestError);
  });
});
