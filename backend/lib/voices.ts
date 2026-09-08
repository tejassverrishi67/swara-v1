/**
 * Voice / model / language compatibility (Features.md F-14)
 * ========================================================
 *
 * Sarvam couples the speaker to the Bulbul model version: a v2 speaker on a v3
 * model (or vice-versa) is a 400 at speak time — the worst possible moment to
 * discover a config error. Before this, that coupling was "documented in a
 * comment and enforced by nothing".
 *
 * This table is the single source of truth. `GET /api/voices` serves the subset
 * valid for the configured model, and `assertVoiceConfig()` fails the process at
 * startup if the configured model and default speaker disagree.
 *
 * Sarvam recognises dozens of speakers per model version, but the picker
 * deliberately exposes only two per version — one female, one male — chosen for
 * voice quality on the current language/model. A wall of near-identical voices
 * was noise, not choice. The ids below are drawn from the rosters Sarvam
 * accepts (v3: the list its REST API returns in a 400 for an unknown speaker,
 * verified 2026-09-07; v2: its published docs), so none can 400 at speak time.
 * `gender` is a best-effort tag used only for the picker icon — a wrong icon is
 * cosmetic, an unknown speaker is a 400, so the ids are what matter.
 */

/** Bulbul model versions we recognise. A bare "vN" is normalised to "bulbul:vN". */
export type BulbulVersion = "v1" | "v2" | "v3";

export interface Voice {
  /** Sarvam speaker id, e.g. "priya". */
  id: string;
  /** Human-facing name. */
  name: string;
  /** Best-effort — "unknown" when the name is ambiguous. Icon only. */
  gender: "female" | "male" | "unknown";
  /** Bulbul versions this speaker is valid on. */
  versions: BulbulVersion[];
  /** Short description for the picker. */
  description: string;
}

/** All BCP-47-ish codes Bulbul accepts. */
export const SUPPORTED_LANGUAGES: Array<{ code: string; name: string; endonym: string }> = [
  { code: "en-IN", name: "English (India)", endonym: "English" },
  { code: "hi-IN", name: "Hindi", endonym: "हिन्दी" },
  { code: "bn-IN", name: "Bengali", endonym: "বাংলা" },
  { code: "gu-IN", name: "Gujarati", endonym: "ગુજરાતી" },
  { code: "kn-IN", name: "Kannada", endonym: "ಕನ್ನಡ" },
  { code: "ml-IN", name: "Malayalam", endonym: "മലയാളം" },
  { code: "mr-IN", name: "Marathi", endonym: "मराठी" },
  { code: "od-IN", name: "Odia", endonym: "ଓଡ଼ିଆ" },
  { code: "pa-IN", name: "Punjabi", endonym: "ਪੰਜਾਬੀ" },
  { code: "ta-IN", name: "Tamil", endonym: "தமிழ்" },
  { code: "te-IN", name: "Telugu", endonym: "తెలుగు" },
];

const LANGUAGE_NAMES = new Map(SUPPORTED_LANGUAGES.map((l) => [l.code, l.name]));

/** Every Bulbul voice knows all of Bulbul's languages — the coupling is version, not language. */
const ALL_LANGS = SUPPORTED_LANGUAGES.map((l) => l.code);

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * bulbul:v3 speakers offered by the picker — one female, one male. `priya` and
 * `anand` are the two clearest v3 voices across the supported languages. Every
 * id here is a real v3 speaker from Sarvam's API roster (verified 2026-09-07).
 */
const V3_SPEAKERS: Array<[string, Voice["gender"]]> = [
  ["priya", "female"], ["anand", "male"],
];

/**
 * bulbul:v2 speakers offered by the picker — one female, one male, from
 * Sarvam's published v2 roster. Only used when SARVAM_MODEL is set to a v2 id.
 */
const V2_SPEAKERS: Array<[string, Voice["gender"]]> = [
  ["anushka", "female"], ["abhilash", "male"],
];

export const VOICES: Voice[] = [
  ...V3_SPEAKERS.map(([id, gender]): Voice => ({
    id, name: cap(id), gender, versions: ["v3"],
    description: `${cap(id)} — Bulbul v3 voice.`,
  })),
  ...V2_SPEAKERS.map(([id, gender]): Voice => ({
    id, name: cap(id), gender, versions: ["v2"],
    description: `${cap(id)} — Bulbul v2 voice.`,
  })),
];

/** A safe default speaker for a model version — used when none is configured. */
export function defaultSpeakerFor(model: string): string {
  const version = normaliseVersion(model);
  return VOICES.find((v) => v.versions.includes(version))?.id ?? "anushka";
}

/** Normalise "v2" | "bulbul:v2" | "bulbul:v2:foo" → "v2". Unknown → "v2". */
export function normaliseVersion(model: string): BulbulVersion {
  const m = model.toLowerCase();
  if (m.includes("v3")) return "v3";
  if (m.includes("v1")) return "v1";
  return "v2";
}

export function languageName(code: string): string {
  return LANGUAGE_NAMES.get(code) ?? code;
}

export function isSupportedLanguage(code: string): boolean {
  return LANGUAGE_NAMES.has(code);
}

/** Voices valid for a given model, with their language list resolved. */
export function voicesForModel(model: string): Array<Voice & { languages: string[] }> {
  const version = normaliseVersion(model);
  return VOICES.filter((v) => v.versions.includes(version)).map((v) => ({ ...v, languages: ALL_LANGS }));
}

export function isVoiceCompatible(speakerId: string, model: string, language?: string): boolean {
  const version = normaliseVersion(model);
  const voice = VOICES.find((v) => v.id === speakerId.toLowerCase());
  if (!voice || !voice.versions.includes(version)) return false;
  if (language && !isSupportedLanguage(language)) return false;
  return true;
}

/**
 * Throw if the configured model and default speaker are incompatible. Called at
 * startup so a bad `SARVAM_MODEL` / `SARVAM_DEFAULT_SPEAKER` pairing fails fast
 * instead of 400-ing on the first real utterance (F-14).
 */
export function assertVoiceConfig(model: string, defaultSpeaker: string): void {
  if (!isVoiceCompatible(defaultSpeaker, model)) {
    const version = normaliseVersion(model);
    const valid = voicesForModel(model).map((v) => v.id).join(", ") || "(none known)";
    throw new Error(
      `Voice config invalid: speaker "${defaultSpeaker}" is not a Bulbul ${version} voice. ` +
        `Valid ${version} speakers: ${valid}. Set SARVAM_MODEL or SARVAM_DEFAULT_SPEAKER accordingly.`,
    );
  }
}
