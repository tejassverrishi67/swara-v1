/**
 * Trust Ladder unit tests.
 *
 * These cover the behaviour the bug-fixing pass is told to verify explicitly
 * (SWARA_MASTER_PROMPTS.md Prompt 3 §2): first use is "full", repeated confirmed
 * use promotes to "fast", and "instant" is NEVER reached automatically.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Concept } from "@swara/shared";
import { TRUST_LADDER } from "./config.ts";
import {
  conceptCombinationKey,
  resolveTier,
  explainTier,
  registerConfirmedUse,
  pinToInstant,
  unpinFromInstant,
  TrustLadder,
  InMemoryTrustLadderStore,
  FileTrustLadderStore,
} from "./trust-ladder.ts";

const PROMOTE = TRUST_LADDER.PROMOTE_TO_FAST_AFTER_CONFIRMED_USES;

function c(id: string): Concept {
  return { id, emoji: "🔵", label: id };
}

describe("conceptCombinationKey", () => {
  it("is order-independent", () => {
    expect(conceptCombinationKey([c("leg"), c("pain")])).toBe(
      conceptCombinationKey([c("pain"), c("leg")]),
    );
  });

  it("dedupes repeated concepts", () => {
    expect(conceptCombinationKey([c("leg"), c("leg"), c("pain")])).toBe("leg+pain");
  });

  it("accepts raw id strings too", () => {
    expect(conceptCombinationKey(["pain", "leg"])).toBe("leg+pain");
  });

  it("throws when there is no usable concept id", () => {
    expect(() => conceptCombinationKey([])).toThrow();
    expect(() => conceptCombinationKey([" ", ""])).toThrow();
  });
});

describe("resolveTier (pure)", () => {
  it("returns 'full' for an unknown combination", () => {
    expect(resolveTier(undefined)).toBe("full");
  });

  it("echoes the stored tier otherwise", () => {
    expect(resolveTier({ conceptCombinationKey: "k", tier: "fast", useCount: 5 })).toBe("fast");
  });
});

describe("registerConfirmedUse (pure)", () => {
  const key = "leg+pain";

  it("creates a 'full' entry on first confirmed use", () => {
    const entry = registerConfirmedUse(undefined, key, "My leg hurts.");
    expect(entry).toMatchObject({
      conceptCombinationKey: key,
      tier: "full",
      approvedInterpretation: "My leg hurts.",
      useCount: 1,
    });
  });

  it("stays 'full' until the promotion threshold, then flips to 'fast'", () => {
    let entry = registerConfirmedUse(undefined, key, "My leg hurts.");
    for (let use = 2; use < PROMOTE; use++) {
      entry = registerConfirmedUse(entry, key, "My leg hurts.");
      expect(entry.tier).toBe("full");
    }
    entry = registerConfirmedUse(entry, key, "My leg hurts."); // this is use #PROMOTE
    expect(entry.useCount).toBe(PROMOTE);
    expect(entry.tier).toBe("fast");
  });

  it("resets tier and count when the confirmed interpretation changes", () => {
    let entry = registerConfirmedUse(undefined, key, "My leg hurts.");
    for (let i = 0; i < PROMOTE + 3; i++) entry = registerConfirmedUse(entry, key, "My leg hurts.");
    expect(entry.tier).toBe("fast");

    entry = registerConfirmedUse(entry, key, "My leg feels numb."); // different meaning
    expect(entry).toMatchObject({ tier: "full", approvedInterpretation: "My leg feels numb.", useCount: 1 });
  });

  it("NEVER promotes to 'instant' automatically, no matter how many confirmations", () => {
    let entry = registerConfirmedUse(undefined, key, "I need help.");
    for (let i = 0; i < 50; i++) {
      entry = registerConfirmedUse(entry, key, "I need help.");
      expect(entry.tier).not.toBe("instant");
    }
  });

  it("leaves a pinned (instant) entry pinned, only bumping useCount", () => {
    const pinned = pinToInstant(undefined, key, "I need help.");
    const after = registerConfirmedUse(pinned, key, "I need help.");
    expect(after.tier).toBe("instant");
    expect(after.pinnedText).toBe("I need help.");
    expect(after.useCount).toBe(pinned.useCount + 1);
  });

  it("rejects an empty interpretation", () => {
    expect(() => registerConfirmedUse(undefined, key, "   ")).toThrow();
  });

  it("does not mutate the input entry", () => {
    const entry = registerConfirmedUse(undefined, key, "My leg hurts.");
    const snapshot = JSON.stringify(entry);
    registerConfirmedUse(entry, key, "My leg hurts.");
    expect(JSON.stringify(entry)).toBe(snapshot);
  });
});

describe("pinToInstant / unpinFromInstant (pure)", () => {
  const key = "help+now";

  it("pins to 'instant' with the fixed phrase, from no prior entry", () => {
    const entry = pinToInstant(undefined, key, "I need help now.");
    expect(entry).toMatchObject({ tier: "instant", pinnedText: "I need help now.", useCount: 0 });
  });

  it("preserves prior history when pinning an existing entry", () => {
    let entry = registerConfirmedUse(undefined, key, "I need help now.");
    entry = registerConfirmedUse(entry, key, "I need help now.");
    const pinned = pinToInstant(entry, key, "I need help now.");
    expect(pinned.tier).toBe("instant");
    expect(pinned.useCount).toBe(2);
    expect(pinned.approvedInterpretation).toBe("I need help now.");
  });

  it("rejects an empty pinned phrase", () => {
    expect(() => pinToInstant(undefined, key, "  ")).toThrow();
  });

  it("unpin drops back to 'full' when history is thin", () => {
    const pinned = pinToInstant(undefined, key, "I need help now.");
    expect(unpinFromInstant(pinned).tier).toBe("full");
  });

  it("unpin drops back to 'fast' when history qualifies", () => {
    let entry = registerConfirmedUse(undefined, key, "I need help now.");
    for (let i = 0; i < PROMOTE + 2; i++) entry = registerConfirmedUse(entry, key, "I need help now.");
    const pinned = pinToInstant(entry, key, "I need help now.");
    const unpinned = unpinFromInstant(pinned);
    expect(unpinned.tier).toBe("fast");
    expect(unpinned.pinnedText).toBeUndefined();
  });

  it("unpin is a no-op for a non-instant entry", () => {
    const entry = registerConfirmedUse(undefined, key, "x");
    expect(unpinFromInstant(entry)).toBe(entry);
  });
});

describe("explainTier", () => {
  it("explains each tier without throwing", () => {
    expect(explainTier(undefined).tier).toBe("full");
    const full = registerConfirmedUse(undefined, "k", "x");
    expect(explainTier(full).tier).toBe("full");
    expect(explainTier(full).reason).toMatch(/fast/i);
    const pinned = pinToInstant(undefined, "k", "phrase");
    expect(explainTier(pinned).reason).toMatch(/pinned/i);
  });
});

describe("TrustLadder facade (with a store)", () => {
  let ladder: TrustLadder;
  const concepts = [c("leg"), c("pain")];

  beforeEach(() => {
    ladder = new TrustLadder(new InMemoryTrustLadderStore());
  });

  it("starts a new combination at 'full'", async () => {
    expect(await ladder.tierFor(concepts)).toBe("full");
  });

  it("promotes to 'fast' after enough confirmations, and persists", async () => {
    for (let i = 0; i < PROMOTE; i++) await ladder.confirm(concepts, "My leg hurts.");
    expect(await ladder.tierFor(concepts)).toBe("fast");
    // order-independent key -> same entry
    expect(await ladder.tierFor([c("pain"), c("leg")])).toBe("fast");
  });

  it("pin / unpin round-trips through the store", async () => {
    await ladder.pin(concepts, "My leg hurts.");
    expect(await ladder.tierFor(concepts)).toBe("instant");
    await ladder.unpin(concepts);
    expect(await ladder.tierFor(concepts)).toBe("full");
  });
});

describe("FileTrustLadderStore", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "swara-tl-"));
    file = path.join(dir, "trust-ladder.json");
  });

  it("persists entries across store instances", async () => {
    const a = new TrustLadder(new FileTrustLadderStore(file));
    for (let i = 0; i < TRUST_LADDER.PROMOTE_TO_FAST_AFTER_CONFIRMED_USES; i++) {
      await a.confirm([c("water"), c("want")], "I would like some water.");
    }
    const b = new TrustLadder(new FileTrustLadderStore(file));
    expect(await b.tierFor([c("want"), c("water")])).toBe("fast");
  });
});
