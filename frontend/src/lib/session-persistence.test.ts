/**
 * localStorage session persistence (Features.md F-08).
 *
 * Runs under the "node" vitest environment, so `window.localStorage` is stubbed.
 * The contract that matters: every path is safe when storage throws or is
 * missing, and a resumable snapshot round-trips.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSession,
  isResumable,
  loadSession,
  saveSession,
} from "./session-persistence.ts";
import type { PersistedSession } from "../state/session-flow.ts";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const snapshot: PersistedSession = {
  language: "hi-IN",
  speaker: "priya",
  selectedConcepts: [{ id: "leg", emoji: "🦵", label: "leg" }],
  stagedText: "My leg hurts.",
  savedAt: "2026-09-07T00:00:00.000Z",
};

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: memoryStorage() });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveSession / loadSession", () => {
  it("round-trips a snapshot", () => {
    saveSession(snapshot);
    expect(loadSession()).toEqual(snapshot);
  });

  it("returns null when nothing is stored", () => {
    expect(loadSession()).toBeNull();
  });

  it("returns null for corrupt / partial JSON", () => {
    window.localStorage.setItem("swara.session.v1", "{not json");
    expect(loadSession()).toBeNull();
    window.localStorage.setItem("swara.session.v1", JSON.stringify({ language: "hi-IN" }));
    expect(loadSession()).toBeNull();
  });

  it("clearSession removes it", () => {
    saveSession(snapshot);
    clearSession();
    expect(loadSession()).toBeNull();
  });

  it("never throws when storage itself throws", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem() {
          throw new Error("blocked");
        },
        setItem() {
          throw new Error("quota");
        },
        removeItem() {
          throw new Error("blocked");
        },
      },
    });
    expect(() => saveSession(snapshot)).not.toThrow();
    expect(loadSession()).toBeNull();
    expect(() => clearSession()).not.toThrow();
  });
});

describe("isResumable", () => {
  it("is true when concepts or staged text are present", () => {
    expect(isResumable(snapshot)).toBe(true);
    expect(isResumable({ ...snapshot, stagedText: undefined })).toBe(true); // concepts present
    expect(isResumable({ ...snapshot, selectedConcepts: [], stagedText: "x" })).toBe(true);
  });

  it("is false for an empty snapshot or null", () => {
    expect(isResumable({ ...snapshot, selectedConcepts: [], stagedText: undefined })).toBe(false);
    expect(isResumable(null)).toBe(false);
  });
});
