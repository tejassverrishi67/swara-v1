/**
 * Client-side palette state (Features.md F-10).
 * ============================================
 *
 * There are no switchable named boards any more — the app shows one unified tile
 * set. This module keeps localStorage for: user-created tiles, and a per-concept
 * usage tally (ordered by *this user's* actual use — the provenance log would
 * also have this, but keeping it local needs no read endpoint and never leaves
 * the device).
 *
 * Every accessor is wrapped — storage can be absent, full, or throw.
 */

import type { Concept } from "@swara/shared";

const K_USER_CONCEPTS = "swara.palette.userConcepts.v1";
const K_USAGE = "swara.palette.usage.v1";
const K_TILE_ORDER = "swara.palette.tileOrder.v1";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function getUserConcepts(): Concept[] {
  const list = read<Concept[]>(K_USER_CONCEPTS, []);
  return Array.isArray(list) ? list.filter((c) => c && c.id && c.label) : [];
}
export function addUserConcept(concept: Concept): Concept[] {
  const list = getUserConcepts().filter((c) => c.id !== concept.id);
  const next = [...list, { ...concept, userDefined: true }];
  write(K_USER_CONCEPTS, next);
  return next;
}
export function removeUserConcept(id: string): Concept[] {
  const next = getUserConcepts().filter((c) => c.id !== id);
  write(K_USER_CONCEPTS, next);
  return next;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Custom tile order (drag-and-drop rearranging) — per device.
 * ──────────────────────────────────────────────────────────────────────────── */

/** The user's saved tile order as a full list of concept ids. `[]` = never rearranged. */
export function getTileOrder(): string[] {
  const list = read<string[]>(K_TILE_ORDER, []);
  return Array.isArray(list) ? list.filter((s): s is string => typeof s === "string" && s.length > 0) : [];
}

export function setTileOrder(ids: string[]): void {
  write(K_TILE_ORDER, ids);
}

/**
 * Sort `pool` by the saved `order`: ids present in `order` come first, in that
 * order; ids not in `order` (e.g. tiles added since the last rearrange) keep
 * their natural relative position and are appended after. Stale ids in `order`
 * (concepts that no longer exist) are simply ignored. Returns `pool` unchanged
 * when `order` is empty.
 */
export function applyTileOrder(pool: Concept[], order: string[]): Concept[] {
  if (order.length === 0) return pool;
  const rank = new Map(order.map((id, i) => [id, i] as const));
  const ranked: Concept[] = [];
  const rest: Concept[] = [];
  for (const c of pool) (rank.has(c.id) ? ranked : rest).push(c);
  ranked.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return [...ranked, ...rest];
}

export type UsageMap = Record<string, number>;

export function getUsage(): UsageMap {
  const m = read<UsageMap>(K_USAGE, {});
  return m && typeof m === "object" ? m : {};
}
/** Bump the tally for each concept in a spoken message. */
export function recordUsage(concepts: Concept[]): void {
  const m = getUsage();
  for (const c of concepts) m[c.id] = (m[c.id] ?? 0) + 1;
  write(K_USAGE, m);
}

/**
 * The N most-used concepts from `pool`, most-frequent first. Concepts never used
 * are excluded, so an empty result simply means "no history yet".
 */
export function frequentConcepts(pool: Concept[], limit = 8): Concept[] {
  const usage = getUsage();
  return pool
    .filter((c) => (usage[c.id] ?? 0) > 0)
    .sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0))
    .slice(0, limit);
}
