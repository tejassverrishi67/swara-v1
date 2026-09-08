/**
 * Trust Ladder — tier state machine
 * =================================
 *
 * Decides how much confirmation friction a given concept combination requires,
 * so that a population for whom every interaction has real effort is not forced
 * through the full Meaning Check on a phrase they have already confirmed many
 * times (SWARA_KNOWLEDGE.md §9b).
 *
 *   full    -> new or low-confidence combo. Full flow: interpretation + confirm +
 *              3 expressions + choice.
 *   fast    -> combo used before with the SAME interpretation reconfirmed. Brief
 *              interpretation, one-tap confirm, skip to expressions.
 *   instant -> user has explicitly pinned this exact combo to a fixed phrase.
 *              Speaks immediately. **Only ever reached via `pinToInstant`.**
 *
 * This module is split into three layers:
 *   1. Pure helpers + pure transition functions  — no I/O, fully unit-tested.
 *   2. `TrustLadderStore`                          — persistence interface + two impls.
 *   3. `TrustLadder`                               — a small facade wiring 1 + 2 together.
 *
 * The pure layer is the important part and is deliberately independent of any
 * LLM/API call. Callers that already hold an entry can use layer 1 directly;
 * callers that want persistence use layer 3.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { Concept, TrustLadderEntry, TrustTier } from "@swara/shared";
import { TRUST_LADDER } from "./config.ts";

/* ══════════════════════════════════════════════════════════════════════════════
 * LAYER 1 — pure logic
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Canonical, **order-independent** key for a set of concepts.
 *
 * The product model treats a message as an unordered set of concepts
 * (SWARA_KNOWLEDGE.md §4), so "leg + pain" and "pain + leg" must map to the same
 * ladder entry. Duplicates are collapsed. Accepts either `Concept[]` or a raw
 * list of ids.
 *
 * Example: `conceptCombinationKey([{id:"pain"},{id:"leg"},{id:"leg"}])` -> `"leg+pain"`.
 */
export function conceptCombinationKey(
  concepts: ReadonlyArray<Concept | string>,
): string {
  const ids = concepts.map((c) => (typeof c === "string" ? c : c.id));
  const cleaned = ids
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (cleaned.length === 0) {
    throw new Error("conceptCombinationKey: at least one non-empty concept id is required");
  }
  const unique = Array.from(new Set(cleaned));
  unique.sort(); // lexicographic; stable across calls
  return unique.join("+");
}

/**
 * The tier that currently applies to a combination, given its stored entry (or
 * `undefined` if the combination has never been seen).
 *
 * This is the ONLY function callers should use to ask "what tier is this?". It
 * never mutates and never promotes — promotion happens in
 * {@link registerConfirmedUse}.
 */
export function resolveTier(entry: TrustLadderEntry | undefined): TrustTier {
  if (!entry) return "full";
  return entry.tier;
}

/** A human-readable explanation of why a combination is at its current tier. */
export interface TierExplanation {
  tier: TrustTier;
  reason: string;
}

/** Explain the current tier decision — handy for the later debugging pass and for UI copy. */
export function explainTier(entry: TrustLadderEntry | undefined): TierExplanation {
  if (!entry) {
    return { tier: "full", reason: "New concept combination — never confirmed before." };
  }
  switch (entry.tier) {
    case "instant":
      return {
        tier: "instant",
        reason: `Explicitly pinned by the user to a fixed phrase: "${entry.pinnedText ?? ""}".`,
      };
    case "fast":
      return {
        tier: "fast",
        reason:
          `Confirmed ${entry.useCount} time(s) with the same interpretation ` +
          `("${entry.approvedInterpretation ?? ""}"), at or past the promotion ` +
          `threshold of ${TRUST_LADDER.PROMOTE_TO_FAST_AFTER_CONFIRMED_USES}.`,
      };
    case "full":
    default:
      return {
        tier: "full",
        reason:
          `Seen before but confirmed only ${entry.useCount} time(s) with the ` +
          `current interpretation — needs ` +
          `${TRUST_LADDER.PROMOTE_TO_FAST_AFTER_CONFIRMED_USES} to move to "fast".`,
      };
  }
}

/**
 * Fold a *confirmed* use of a combination into its ladder entry and return the
 * NEW entry (pure — does not mutate the input).
 *
 * Call this exactly once per message that reached the user-confirmation step and
 * was confirmed (full and fast tiers). Do NOT call it for instant-tier
 * utterances — those have no confirmation step.
 *
 * Transition rules:
 *   - No prior entry:
 *       -> new entry { tier: "full", approvedInterpretation, useCount: 1 }.
 *   - Prior entry is "instant" (pinned):
 *       -> left as-is. A pin is a deliberate user choice; a stray confirmation
 *          must not silently un-pin or otherwise disturb it. `useCount` is bumped
 *          so history stays meaningful.
 *   - Confirmed interpretation DIFFERS from `approvedInterpretation`:
 *       -> RESET: { tier: "full", approvedInterpretation: <new>, useCount: 1 }.
 *          Rationale: a promotion is a statement about a specific meaning. If the
 *          user is now confirming a different meaning for the same concepts, the
 *          old promotion is not evidence for the new meaning and must not carry
 *          over (guards the meaning-drift failure mode in SWARA_KNOWLEDGE.md §7).
 *   - Same interpretation as before:
 *       -> increment `useCount`; if tier is "full" and useCount has reached
 *          PROMOTE_TO_FAST_AFTER_CONFIRMED_USES, promote to "fast".
 *
 * NOTE: there is deliberately no branch anywhere in this function that can
 * produce `tier: "instant"`. That transition exists only in {@link pinToInstant}.
 */
export function registerConfirmedUse(
  entry: TrustLadderEntry | undefined,
  key: string,
  confirmedInterpretation: string,
): TrustLadderEntry {
  const interpretation = confirmedInterpretation.trim();
  if (interpretation === "") {
    throw new Error("registerConfirmedUse: confirmedInterpretation must not be empty");
  }

  // First time we have ever seen this combination.
  if (!entry) {
    return {
      conceptCombinationKey: key,
      tier: "full",
      approvedInterpretation: interpretation,
      useCount: 1,
    };
  }

  // Pinned combinations are inert to confirmations — see rule above.
  if (entry.tier === "instant") {
    return { ...entry, useCount: entry.useCount + 1 };
  }

  // The user is confirming a different meaning than last time -> reset the ladder.
  if (entry.approvedInterpretation !== interpretation) {
    return {
      conceptCombinationKey: key,
      tier: "full",
      approvedInterpretation: interpretation,
      useCount: 1,
    };
  }

  // Same meaning reconfirmed -> count it, and maybe promote full -> fast.
  const useCount = entry.useCount + 1;
  const shouldPromote =
    entry.tier === "full" &&
    useCount >= TRUST_LADDER.PROMOTE_TO_FAST_AFTER_CONFIRMED_USES;

  return {
    ...entry,
    approvedInterpretation: interpretation,
    useCount,
    tier: shouldPromote ? "fast" : entry.tier,
  };
}

/**
 * Explicitly pin a combination to the "instant" tier with a fixed phrase.
 *
 * This is the ONLY path to `tier: "instant"`. It represents a deliberate trade
 * the user makes — giving up the confirmation step in exchange for speed on a
 * well-established phrase like "I need help" (SWARA_KNOWLEDGE.md §9b). The UI
 * must gate this behind a clear, deliberate confirmation (SWARA_MASTER_PROMPTS.md
 * Prompt 4 §7); this function assumes that has already happened.
 *
 * Pure — returns a new entry.
 */
export function pinToInstant(
  entry: TrustLadderEntry | undefined,
  key: string,
  pinnedText: string,
): TrustLadderEntry {
  const text = pinnedText.trim();
  if (text === "") {
    throw new Error("pinToInstant: pinnedText must not be empty");
  }
  return {
    conceptCombinationKey: key,
    tier: "instant",
    pinnedText: text,
    // Preserve any meaning/history we already had for context; it is not used
    // while pinned but is useful if the user later unpins.
    approvedInterpretation: entry?.approvedInterpretation,
    useCount: entry?.useCount ?? 0,
  };
}

/**
 * Remove an "instant" pin and drop the combination back onto the automatic
 * ladder. The resulting tier is recomputed from `useCount`: "fast" if it is at
 * or past the promotion threshold, otherwise "full". Pure.
 *
 * A no-op (returns the entry unchanged) if it was not pinned.
 */
export function unpinFromInstant(entry: TrustLadderEntry): TrustLadderEntry {
  if (entry.tier !== "instant") return entry;
  const qualifiesForFast =
    entry.useCount >= TRUST_LADDER.PROMOTE_TO_FAST_AFTER_CONFIRMED_USES &&
    (entry.approvedInterpretation ?? "") !== "";
  const { pinnedText: _removed, ...rest } = entry;
  return { ...rest, tier: qualifiesForFast ? "fast" : "full" };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * LAYER 2 — persistence interface + implementations
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Storage-agnostic persistence for Trust Ladder entries. Swap the implementation
 * (in-memory for tests/dev, file for a single-user local build, a DB adapter
 * later) without any caller changing.
 */
export interface TrustLadderStore {
  get(key: string): Promise<TrustLadderEntry | undefined>;
  put(entry: TrustLadderEntry): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<TrustLadderEntry[]>;
}

/** In-memory store. State lives for the life of the process. Good for tests and dev. */
export class InMemoryTrustLadderStore implements TrustLadderStore {
  private readonly entries = new Map<string, TrustLadderEntry>();

  async get(key: string): Promise<TrustLadderEntry | undefined> {
    const found = this.entries.get(key);
    return found ? { ...found } : undefined;
  }

  async put(entry: TrustLadderEntry): Promise<void> {
    this.entries.set(entry.conceptCombinationKey, { ...entry });
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async list(): Promise<TrustLadderEntry[]> {
    return Array.from(this.entries.values()).map((e) => ({ ...e }));
  }
}

/**
 * JSON-file store: the whole ladder is a single JSON object `{ [key]: entry }`.
 * Rewritten on every `put`/`delete`. Fine for a single local user; not for
 * concurrent writers. Kept intentionally dumb — a real deployment swaps in a DB
 * adapter behind the same interface.
 */
export class FileTrustLadderStore implements TrustLadderStore {
  constructor(private readonly filePath: string) {}

  private async readAll(): Promise<Record<string, TrustLadderEntry>> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return raw.trim() === "" ? {} : (JSON.parse(raw) as Record<string, TrustLadderEntry>);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw err;
    }
  }

  private async writeAll(data: Record<string, TrustLadderEntry>): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  async get(key: string): Promise<TrustLadderEntry | undefined> {
    return (await this.readAll())[key];
  }

  async put(entry: TrustLadderEntry): Promise<void> {
    const all = await this.readAll();
    all[entry.conceptCombinationKey] = entry;
    await this.writeAll(all);
  }

  async delete(key: string): Promise<void> {
    const all = await this.readAll();
    delete all[key];
    await this.writeAll(all);
  }

  async list(): Promise<TrustLadderEntry[]> {
    return Object.values(await this.readAll());
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
 * LAYER 3 — facade: pure logic + a store
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Convenience wrapper most callers will use. Holds a {@link TrustLadderStore} and
 * applies the pure transitions above, persisting the result.
 *
 * Every method takes the concept set (or a pre-computed key) so callers never
 * have to think about key derivation.
 */
export class TrustLadder {
  constructor(private readonly store: TrustLadderStore = new InMemoryTrustLadderStore()) {}

  private keyOf(concepts: ReadonlyArray<Concept | string> | string): string {
    return typeof concepts === "string" ? concepts : conceptCombinationKey(concepts);
  }

  /** The tier that currently applies to this combination. */
  async tierFor(concepts: ReadonlyArray<Concept | string> | string): Promise<TrustTier> {
    return resolveTier(await this.store.get(this.keyOf(concepts)));
  }

  /** Full explanation of the current tier — tier + reason. */
  async explain(
    concepts: ReadonlyArray<Concept | string> | string,
  ): Promise<TierExplanation> {
    return explainTier(await this.store.get(this.keyOf(concepts)));
  }

  /** The raw stored entry, if any. */
  async getEntry(
    concepts: ReadonlyArray<Concept | string> | string,
  ): Promise<TrustLadderEntry | undefined> {
    return this.store.get(this.keyOf(concepts));
  }

  /**
   * Record that the user confirmed `confirmedInterpretation` for this
   * combination. Returns the updated entry (already persisted). See
   * {@link registerConfirmedUse} for the transition rules.
   */
  async confirm(
    concepts: ReadonlyArray<Concept | string> | string,
    confirmedInterpretation: string,
  ): Promise<TrustLadderEntry> {
    const key = this.keyOf(concepts);
    const next = registerConfirmedUse(await this.store.get(key), key, confirmedInterpretation);
    await this.store.put(next);
    return next;
  }

  /**
   * Explicitly pin this combination to "instant" with a fixed phrase. The only
   * way to reach the instant tier. Returns the persisted entry.
   */
  async pin(
    concepts: ReadonlyArray<Concept | string> | string,
    pinnedText: string,
  ): Promise<TrustLadderEntry> {
    const key = this.keyOf(concepts);
    const next = pinToInstant(await this.store.get(key), key, pinnedText);
    await this.store.put(next);
    return next;
  }

  /** Remove an instant pin and return the combination to the automatic ladder. */
  async unpin(
    concepts: ReadonlyArray<Concept | string> | string,
  ): Promise<TrustLadderEntry | undefined> {
    const key = this.keyOf(concepts);
    const current = await this.store.get(key);
    if (!current) return undefined;
    const next = unpinFromInstant(current);
    await this.store.put(next);
    return next;
  }

  /** All known entries. */
  async all(): Promise<TrustLadderEntry[]> {
    return this.store.list();
  }
}
