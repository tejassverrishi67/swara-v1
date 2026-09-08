/**
 * localStorage IO for the in-progress session (Features.md F-08).
 * ==============================================================
 *
 * The reducer owns *what* is persistable (`persistableSnapshot` /
 * `restoreFlowContext` in state/session-flow.ts); this module owns *where* it
 * goes. Every read/write is wrapped — a private window, disabled storage, or a
 * quota error must never break the app.
 */

import type { PersistedSession } from "../state/session-flow.ts";

const KEY = "swara.session.v1";

/** Persist the snapshot. Silently no-ops if storage is unavailable. */
export function saveSession(snapshot: PersistedSession): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    /* storage disabled / full — losing the draft is bad but crashing is worse */
  }
}

/** Load the last snapshot, or `null` if there is none / it is unreadable. */
export function loadSession(): PersistedSession | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedSession>;
    if (
      typeof parsed?.language !== "string" ||
      typeof parsed?.speaker !== "string" ||
      !Array.isArray(parsed?.selectedConcepts)
    ) {
      return null;
    }
    return parsed as PersistedSession;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** True when the snapshot represents an interrupted, resumable composition. */
export function isResumable(snapshot: PersistedSession | null): snapshot is PersistedSession {
  return !!snapshot && (snapshot.selectedConcepts.length > 0 || !!snapshot.stagedText);
}
