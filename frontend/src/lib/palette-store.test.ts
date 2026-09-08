/**
 * Client-side palette state (Features.md F-10).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Concept } from "@swara/shared";
import {
  addUserConcept,
  applyTileOrder,
  frequentConcepts,
  getTileOrder,
  getUserConcepts,
  recordUsage,
  removeUserConcept,
  setTileOrder,
} from "./palette-store.ts";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const con = (id: string): Concept => ({ id, emoji: "🔵", label: id });

beforeEach(() => vi.stubGlobal("window", { localStorage: memoryStorage() }));
afterEach(() => vi.unstubAllGlobals());

describe("user concepts", () => {
  it("adds, de-dupes by id, marks userDefined, and removes", () => {
    addUserConcept(con("cat"));
    addUserConcept({ ...con("cat"), label: "kitty" }); // same id → replace
    addUserConcept(con("dog"));
    const list = getUserConcepts();
    expect(list.map((c) => c.id).sort()).toEqual(["cat", "dog"]);
    expect(list.every((c) => c.userDefined)).toBe(true);
    expect(list.find((c) => c.id === "cat")!.label).toBe("kitty");

    removeUserConcept("cat");
    expect(getUserConcepts().map((c) => c.id)).toEqual(["dog"]);
  });
});

describe("custom tile order", () => {
  it("round-trips through storage, filtering out junk", () => {
    expect(getTileOrder()).toEqual([]);
    setTileOrder(["c", "a", "b"]);
    expect(getTileOrder()).toEqual(["c", "a", "b"]);
  });

  it("applyTileOrder ranks known ids first (in saved order), appends the rest in place", () => {
    const pool = ["a", "b", "c", "d"].map(con);
    // never rearranged -> unchanged
    expect(applyTileOrder(pool, []).map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
    // full saved order
    expect(applyTileOrder(pool, ["d", "b", "a", "c"]).map((c) => c.id)).toEqual(["d", "b", "a", "c"]);
    // partial order (e.g. tiles added since the rearrange) — "c","d" keep their order at the end
    expect(applyTileOrder(pool, ["b", "a"]).map((c) => c.id)).toEqual(["b", "a", "c", "d"]);
    // stale id in the saved order is ignored
    expect(applyTileOrder(pool, ["gone", "c", "a"]).map((c) => c.id)).toEqual(["c", "a", "b", "d"]);
  });
});

describe("usage + frequentConcepts", () => {
  it("orders by this user's tally, excludes unused, respects the limit", () => {
    const pool = ["a", "b", "c", "d"].map(con);
    recordUsage([con("b"), con("c")]);
    recordUsage([con("b")]);
    recordUsage([con("b"), con("d")]);
    // tallies: b=3, c=1, d=1, a=0
    const freq = frequentConcepts(pool, 2);
    expect(freq.map((c) => c.id)).toEqual(["b", "c"]);
    expect(frequentConcepts(pool).map((c) => c.id)).not.toContain("a");
  });

  it("returns nothing when there is no history", () => {
    expect(frequentConcepts(["a", "b"].map(con))).toEqual([]);
  });
});
