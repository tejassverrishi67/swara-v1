/**
 * Accessibility settings (Features.md F-15).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, sanitise, saveSettings } from "./settings.ts";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

beforeEach(() => {
  vi.stubGlobal("window", {
    localStorage: memoryStorage(),
    matchMedia: () => ({ matches: false }),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("sanitise", () => {
  it("keeps in-range values and drops out-of-range / wrong-type ones", () => {
    expect(sanitise({ textScale: 1.5 })).toEqual({ textScale: 1.5 });
    expect(sanitise({ textScale: 9 })).toEqual({});
    expect(sanitise({ scanIntervalMs: 100 })).toEqual({}); // below floor
    expect(sanitise({ scanIntervalMs: 2000 })).toEqual({ scanIntervalMs: 2000 });
    expect(sanitise({ dwellMs: -5 })).toEqual({});
    expect(sanitise({ reduceMotion: "yes" as unknown as boolean })).toEqual({});
    expect(sanitise({ highContrast: true, scanEnabled: true })).toEqual({
      highContrast: true,
      scanEnabled: true,
    });
  });
});

describe("load / save", () => {
  it("returns defaults when nothing is stored", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips and merges partial stored settings over defaults", () => {
    saveSettings({ ...DEFAULT_SETTINGS, textScale: 1.4, scanEnabled: true });
    const loaded = loadSettings();
    expect(loaded.textScale).toBe(1.4);
    expect(loaded.scanEnabled).toBe(true);
    expect(loaded.dwellMs).toBe(DEFAULT_SETTINGS.dwellMs);
  });

  it("falls back to defaults on corrupt JSON", () => {
    window.localStorage.setItem("swara.a11y.v1", "{oops");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("ignores a stored out-of-range value, keeping the default", () => {
    window.localStorage.setItem("swara.a11y.v1", JSON.stringify({ textScale: 99 }));
    expect(loadSettings().textScale).toBe(DEFAULT_SETTINGS.textScale);
  });
});
