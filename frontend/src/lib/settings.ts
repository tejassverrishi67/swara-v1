/**
 * Accessibility settings (Features.md F-15)
 * ========================================
 *
 * Text scale, motion, scan speed, dwell time, high-contrast — all persisted, all
 * applied to the document root as attributes / a CSS custom property so the
 * stylesheet can react. `prefers-reduced-motion` is honoured as the default for
 * the motion setting.
 */

export interface A11ySettings {
  /** 1.0 = default. Multiplies the root font size. */
  textScale: number;
  /** Disable the pulse dot, the audio-wave bars, and tile press-scale. */
  reduceMotion: boolean;
  /** Enable single-switch scanning. */
  scanEnabled: boolean;
  /** Milliseconds each target is highlighted while scanning. */
  scanIntervalMs: number;
  /** Milliseconds of hover before a dwell click fires (0 = dwell off). */
  dwellMs: number;
  /** High-contrast theme. */
  highContrast: boolean;
  /** The key that activates the highlighted target in scanning mode. */
  activationKey: string;
}

export const DEFAULT_SETTINGS: A11ySettings = {
  textScale: 1,
  reduceMotion: prefersReducedMotion(),
  scanEnabled: false,
  scanIntervalMs: 1200,
  dwellMs: 0,
  highContrast: false,
  activationKey: " ", // space
};

const KEY = "swara.a11y.v1";

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function loadSettings(): A11ySettings {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<A11ySettings>;
    return { ...DEFAULT_SETTINGS, ...sanitise(parsed) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: A11ySettings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

/** Clamp / type-guard external values so a corrupt store cannot break layout. */
export function sanitise(s: Partial<A11ySettings>): Partial<A11ySettings> {
  const out: Partial<A11ySettings> = {};
  if (typeof s.textScale === "number" && s.textScale >= 0.8 && s.textScale <= 2.5) out.textScale = s.textScale;
  if (typeof s.reduceMotion === "boolean") out.reduceMotion = s.reduceMotion;
  if (typeof s.scanEnabled === "boolean") out.scanEnabled = s.scanEnabled;
  if (typeof s.scanIntervalMs === "number" && s.scanIntervalMs >= 400 && s.scanIntervalMs <= 5000) {
    out.scanIntervalMs = s.scanIntervalMs;
  }
  if (typeof s.dwellMs === "number" && s.dwellMs >= 0 && s.dwellMs <= 5000) out.dwellMs = s.dwellMs;
  if (typeof s.highContrast === "boolean") out.highContrast = s.highContrast;
  if (typeof s.activationKey === "string" && s.activationKey.length >= 1) out.activationKey = s.activationKey;
  return out;
}

/** Reflect settings onto <html> so index.css can react. Safe to call repeatedly. */
export function applySettings(settings: A11ySettings): void {
  try {
    const root = document.documentElement;
    root.style.setProperty("--text-scale", String(settings.textScale));
    root.toggleAttribute("data-reduce-motion", settings.reduceMotion);
    root.toggleAttribute("data-high-contrast", settings.highContrast);
    root.toggleAttribute("data-scanning", settings.scanEnabled);
  } catch {
    /* SSR / no document — nothing to do */
  }
}
