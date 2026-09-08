import { describe, expect, it } from "vitest";
import type { Concept, Interpretation } from "@swara/shared";
import {
  extractJson,
  interpret,
  isFidelityCompliant,
  parseInterpretRequest,
  rankAndTrimInterpretations,
  InvalidRequestError,
} from "./handler.ts";

describe("api/interpret handler", () => {
  const conceptsConfident: Concept[] = [
    { id: "doctor", emoji: "👨‍⚕️", label: "doctor" },
    { id: "leg", emoji: "🦵", label: "leg" },
    { id: "pain", emoji: "😣", label: "pain" },
    { id: "worse", emoji: "📈", label: "worse" },
  ];

  const conceptsAmbiguous: Concept[] = [
    { id: "cold", emoji: "🥶", label: "cold" },
    { id: "feel", emoji: "✋", label: "feel" },
  ];

  it("returns a single interpretation when reading is clear and high confidence", async () => {
    const res = await interpret({ concepts: conceptsConfident });
    expect(res.interpretations.length).toBe(1);
    expect(res.interpretations[0]?.text.toLowerCase()).toContain("leg");
    expect(res.interpretations[0]?.confidence).toBeGreaterThanOrEqual(0.78);
  });

  it("returns a ranked shortlist of 2-3 candidates when ambiguous", async () => {
    const res = await interpret({ concepts: conceptsAmbiguous });
    expect(res.interpretations.length).toBeGreaterThanOrEqual(2);
    expect(res.interpretations.length).toBeLessThanOrEqual(3);
    // Verified sorted descending by confidence
    for (let i = 0; i < res.interpretations.length - 1; i++) {
      expect(res.interpretations[i]!.confidence).toBeGreaterThanOrEqual(
        res.interpretations[i + 1]!.confidence,
      );
    }
  });

  it("extracts JSON correctly from code fences or raw string", () => {
    const raw = '```json\n{"interpretations":[{"text":"Hello","confidence":0.9}]}\n```';
    const parsed = extractJson<{ interpretations: Interpretation[] }>(raw);
    expect(parsed?.interpretations[0]?.text).toBe("Hello");

    const rawBraced = 'Some intro text {"interpretations":[{"text":"World","confidence":0.8}]} trailing';
    const parsedBraced = extractJson<{ interpretations: Interpretation[] }>(rawBraced);
    expect(parsedBraced?.interpretations[0]?.text).toBe("World");
  });

  it("validates fidelity rules against invented severity or timeframe", () => {
    const concepts: Concept[] = [
      { id: "headache", emoji: "🤕", label: "headache" },
    ];

    expect(isFidelityCompliant("My head hurts.", concepts)).toBe(true);
    expect(isFidelityCompliant("I have a severe headache.", concepts)).toBe(false);
    expect(isFidelityCompliant("I had a headache since yesterday.", concepts)).toBe(false);
  });

  it("rankAndTrimInterpretations trims to 1 only when high confidence and exceeds ambiguity margin", () => {
    const candidates1: Interpretation[] = [
      { text: "Option 1", confidence: 0.85 },
      { text: "Option 2", confidence: 0.65 },
    ];
    const trimmed1 = rankAndTrimInterpretations(candidates1);
    expect(trimmed1).toHaveLength(1);

    const candidates2: Interpretation[] = [
      { text: "Option 1", confidence: 0.70 },
      { text: "Option 2", confidence: 0.68 },
    ];
    const trimmed2 = rankAndTrimInterpretations(candidates2);
    expect(trimmed2.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects invalid request payloads", () => {
    expect(() => parseInterpretRequest(null)).toThrow(InvalidRequestError);
    expect(() => parseInterpretRequest({})).toThrow(InvalidRequestError);
    expect(() => parseInterpretRequest({ concepts: [] })).toThrow(InvalidRequestError);
  });
});
