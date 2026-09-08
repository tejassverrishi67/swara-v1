/**
 * Voice / model / language compatibility (Features.md F-14).
 */

import { describe, expect, it } from "vitest";
import {
  assertVoiceConfig,
  defaultSpeakerFor,
  isSupportedLanguage,
  isVoiceCompatible,
  languageName,
  normaliseVersion,
  voicesForModel,
} from "./voices.ts";

describe("normaliseVersion", () => {
  it("maps model strings to a bare version", () => {
    expect(normaliseVersion("v2")).toBe("v2");
    expect(normaliseVersion("bulbul:v2")).toBe("v2");
    expect(normaliseVersion("bulbul:v3")).toBe("v3");
    expect(normaliseVersion("v3-beta")).toBe("v3");
    expect(normaliseVersion("something-weird")).toBe("v2");
  });
});

describe("voicesForModel", () => {
  it("returns only speakers valid for that model version", () => {
    const v2 = voicesForModel("bulbul:v2").map((v) => v.id);
    const v3 = voicesForModel("bulbul:v3").map((v) => v.id);
    expect(v2).toContain("anushka");
    expect(v2).not.toContain("priya");
    expect(v3).toContain("priya");
    expect(v3).not.toContain("anushka");
  });

  it("attaches the full language list to each voice", () => {
    for (const v of voicesForModel("v2")) {
      expect(v.languages).toContain("hi-IN");
      expect(v.languages).toContain("en-IN");
    }
  });
});

describe("isVoiceCompatible", () => {
  it("is true for a matching speaker/model", () => {
    expect(isVoiceCompatible("anushka", "bulbul:v2")).toBe(true);
    expect(isVoiceCompatible("priya", "bulbul:v3")).toBe(true);
  });
  it("is false across versions or for unknown speakers/languages", () => {
    expect(isVoiceCompatible("anushka", "bulbul:v3")).toBe(false);
    expect(isVoiceCompatible("priya", "bulbul:v2")).toBe(false);
    expect(isVoiceCompatible("nobody", "bulbul:v2")).toBe(false);
    expect(isVoiceCompatible("anushka", "bulbul:v2", "fr-FR")).toBe(false);
  });
});

describe("assertVoiceConfig", () => {
  it("passes for a compatible pairing", () => {
    expect(() => assertVoiceConfig("bulbul:v2", "anushka")).not.toThrow();
    expect(() => assertVoiceConfig("bulbul:v3", "priya")).not.toThrow();
  });
  it("throws — with the valid speakers listed — for a mismatch", () => {
    expect(() => assertVoiceConfig("bulbul:v3", "anushka")).toThrow(/not a Bulbul v3 voice/);
    expect(() => assertVoiceConfig("bulbul:v3", "anushka")).toThrow(/priya/);
  });
});

describe("defaultSpeakerFor", () => {
  it("returns a speaker that is actually valid for the model", () => {
    expect(isVoiceCompatible(defaultSpeakerFor("bulbul:v2"), "bulbul:v2")).toBe(true);
    expect(isVoiceCompatible(defaultSpeakerFor("bulbul:v3"), "bulbul:v3")).toBe(true);
  });
});

describe("languages", () => {
  it("recognises Bulbul language codes and names them", () => {
    expect(isSupportedLanguage("hi-IN")).toBe(true);
    expect(isSupportedLanguage("xx-XX")).toBe(false);
    expect(languageName("ta-IN")).toBe("Tamil");
    expect(languageName("unknown")).toBe("unknown");
  });
});
