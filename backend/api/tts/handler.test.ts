import { describe, it, expect, vi, afterEach } from "vitest";

import { coerceVoiceToConfiguredModel, parseTtsRequest } from "./handler.ts";
import { CONFIG } from "../../lib/config.ts";
import { isVoiceCompatible, isSupportedLanguage } from "../../lib/voices.ts";
import type { TtsRequest } from "@swara/shared";

const base: Omit<TtsRequest, "speaker"> = {
  text: "hello",
  language: "en-IN",
  tier: "full",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("coerceVoiceToConfiguredModel (F-14)", () => {
  it("passes through a speaker that is valid for the configured model", () => {
    const validSpeaker = CONFIG.sarvam.defaultSpeaker;
    const out = coerceVoiceToConfiguredModel({ ...base, speaker: validSpeaker });
    expect(out.speaker).toBe(validSpeaker);
    expect(out.language).toBe("en-IN");
  });

  it("snaps an incompatible speaker to one valid for the configured model", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // "anushka" is a Bulbul v2 voice and "priya" a v3 voice — whichever the test
    // env's model is, at least one of these is incompatible. Try both.
    for (const stale of ["anushka", "priya", "not-a-real-speaker"]) {
      const out = coerceVoiceToConfiguredModel({ ...base, speaker: stale });
      expect(isVoiceCompatible(out.speaker, CONFIG.sarvam.model)).toBe(true);
    }
  });

  it("falls back to the default language when the requested one is unsupported", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = coerceVoiceToConfiguredModel({
      ...base,
      speaker: CONFIG.sarvam.defaultSpeaker,
      language: "fr-FR",
    });
    expect(isSupportedLanguage(out.language)).toBe(true);
    expect(out.language).toBe(CONFIG.sarvam.defaultLanguage);
  });

  it("leaves a supported language untouched", () => {
    const out = coerceVoiceToConfiguredModel({
      ...base,
      speaker: CONFIG.sarvam.defaultSpeaker,
      language: "hi-IN",
    });
    expect(out.language).toBe("hi-IN");
  });
});

describe("parseTtsRequest still rejects malformed bodies", () => {
  it("requires a non-empty speaker", () => {
    expect(() => parseTtsRequest({ ...base, speaker: "" })).toThrow();
  });
  it("requires a valid tier", () => {
    expect(() => parseTtsRequest({ ...base, speaker: "priya", tier: "turbo" })).toThrow();
  });
});
