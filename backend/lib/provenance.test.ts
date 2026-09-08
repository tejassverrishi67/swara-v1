/**
 * Provenance layer unit tests.
 *
 * Covers what the bug-fixing pass must verify (SWARA_MASTER_PROMPTS.md Prompt 3
 * §5): every spoken message, across all three tiers, produces a complete record;
 * writing never throws into the caller; and the store is genuinely swappable.
 *
 * The core suite is parametrised over both shipped stores so they are held to
 * the identical contract.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ProvenanceRecord } from "@swara/shared";
import {
  InMemoryProvenanceStore,
  FileProvenanceStore,
  ProvenanceLog,
  createProvenanceStore,
  validateNewProvenanceRecord,
  type ProvenanceStore,
  type NewProvenanceRecord,
} from "./provenance.ts";

function fullTierRecord(overrides: Partial<ProvenanceRecord> = {}): NewProvenanceRecord {
  return {
    timestamp: "2026-01-01T00:00:00.000Z",
    concepts: [
      { id: "doctor", emoji: "👨‍⚕️", label: "doctor" },
      { id: "leg", emoji: "🦵", label: "leg" },
    ],
    interpretationsShown: [{ text: "Doctor, my leg hurts.", confidence: 0.9 }],
    interpretationConfirmed: { text: "Doctor, my leg hurts.", confidence: 0.9 },
    tierUsed: "full",
    expressionOptionsShown: [
      { emotion: "Neutral / calm", text: "Doctor, my leg hurts." },
      { emotion: "Embarrassed", text: "Excuse me — my leg hurts." },
      { emotion: "In pain", text: "My leg hurts." },
    ],
    finalApprovedText: "Doctor, my leg hurts.",
    wasManuallyEdited: false,
    ...overrides,
  };
}

/** An instant-tier record: no confirmation, no options shown. Must still be valid. */
function instantTierRecord(): NewProvenanceRecord {
  return {
    timestamp: "2026-01-02T00:00:00.000Z",
    concepts: [{ id: "help", emoji: "🆘", label: "help" }],
    interpretationsShown: [],
    interpretationConfirmed: null,
    tierUsed: "instant",
    expressionOptionsShown: [],
    finalApprovedText: "I need help now.",
    wasManuallyEdited: false,
  };
}

describe("validateNewProvenanceRecord", () => {
  it("accepts a well-formed full-tier record", () => {
    expect(validateNewProvenanceRecord(fullTierRecord())).toEqual([]);
  });

  it("accepts a well-formed instant-tier record (null confirmed, empty arrays)", () => {
    expect(validateNewProvenanceRecord(instantTierRecord())).toEqual([]);
  });

  it("does not require timestamp (the log stamps it)", () => {
    const r = fullTierRecord();
    // @ts-expect-error deliberately drop timestamp
    delete r.timestamp;
    expect(validateNewProvenanceRecord(r)).toEqual([]);
  });

  it("flags each missing / wrong required field", () => {
    expect(validateNewProvenanceRecord(null)).not.toEqual([]);
    expect(validateNewProvenanceRecord({ ...fullTierRecord(), concepts: [] })).toContain(
      "`concepts` must be a non-empty array",
    );
    const noConfirmed = fullTierRecord();
    // @ts-expect-error drop a required key
    delete noConfirmed.interpretationConfirmed;
    expect(validateNewProvenanceRecord(noConfirmed)).toContain(
      "`interpretationConfirmed` must be present (object or null)",
    );
    expect(
      validateNewProvenanceRecord({ ...fullTierRecord(), tierUsed: "turbo" }),
    ).toContain('`tierUsed` must be "full" | "fast" | "instant"');
    expect(
      validateNewProvenanceRecord({ ...fullTierRecord(), finalApprovedText: "  " }),
    ).toContain("`finalApprovedText` must be a non-empty string");
    expect(
      validateNewProvenanceRecord({ ...fullTierRecord(), wasManuallyEdited: "no" }),
    ).toContain("`wasManuallyEdited` must be a boolean");
  });
});

const stores: Array<[string, () => ProvenanceStore]> = [
  ["InMemoryProvenanceStore", () => new InMemoryProvenanceStore()],
  [
    "FileProvenanceStore",
    () => new FileProvenanceStore(path.join(os.tmpdir(), `swara-prov-${Math.random().toString(36).slice(2)}.jsonl`)),
  ],
];

describe.each(stores)("ProvenanceStore contract: %s", (_name, makeStore) => {
  let store: ProvenanceStore;

  beforeEach(() => {
    store = makeStore();
  });

  it("assigns an id on append and returns the stored record", async () => {
    const stored = await store.append({ ...fullTierRecord() } as ProvenanceRecord);
    expect(stored.id).toBeTruthy();
    expect(stored.finalApprovedText).toBe("Doctor, my leg hurts.");
    const back = await store.getById(stored.id!);
    expect(back).toEqual(stored);
  });

  it("keeps a caller-provided id", async () => {
    const stored = await store.append({ ...fullTierRecord(), id: "fixed-id" } as ProvenanceRecord);
    expect(stored.id).toBe("fixed-id");
  });

  it("accepts an instant-tier record (null confirmation, empty options)", async () => {
    const stored = await store.append({ ...instantTierRecord() } as ProvenanceRecord);
    expect(stored.interpretationConfirmed).toBeNull();
    expect(stored.expressionOptionsShown).toEqual([]);
    expect(stored.id).toBeTruthy();
  });

  it("lists newest first", async () => {
    await store.append({ ...fullTierRecord({ timestamp: "2026-01-01T00:00:00.000Z" }) } as ProvenanceRecord);
    await store.append({ ...fullTierRecord({ timestamp: "2026-03-01T00:00:00.000Z" }) } as ProvenanceRecord);
    await store.append({ ...fullTierRecord({ timestamp: "2026-02-01T00:00:00.000Z" }) } as ProvenanceRecord);
    const listed = await store.list();
    expect(listed.map((r) => r.timestamp)).toEqual([
      "2026-03-01T00:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ]);
  });

  it("queries by concept id set (order-independent) and time range", async () => {
    await store.append({ ...fullTierRecord({ timestamp: "2026-01-01T00:00:00.000Z" }) } as ProvenanceRecord);
    await store.append({ ...instantTierRecord() } as ProvenanceRecord); // concepts: [help]

    const legPain = await store.query({ conceptIds: ["leg", "doctor"] });
    expect(legPain).toHaveLength(1);
    expect(legPain[0]!.tierUsed).toBe("full");

    // Time range: the full-tier record is 2026-01-01, the instant one 2026-01-02.
    const firstDayOnly = await store.query({
      from: "2026-01-01",
      to: "2026-01-01T23:59:59.999Z",
    });
    expect(firstDayOnly).toHaveLength(1);
    expect(firstDayOnly[0]!.timestamp).toBe("2026-01-01T00:00:00.000Z");

    const fromSecondDay = await store.query({ from: "2026-01-02" });
    expect(fromSecondDay).toHaveLength(1);
    expect(fromSecondDay[0]!.tierUsed).toBe("instant");

    const none = await store.query({ from: "2027-01-01" });
    expect(none).toHaveLength(0);
  });

  it("respects the query limit", async () => {
    for (let i = 0; i < 5; i++) {
      await store.append(
        { ...fullTierRecord({ timestamp: `2026-0${i + 1}-01T00:00:00.000Z` }) } as ProvenanceRecord,
      );
    }
    expect(await store.query({ limit: 2 })).toHaveLength(2);
  });

  /* ── F-05 / F-06 additions ───────────────────────────────────────────────── */

  it("scopes queries by userId", async () => {
    await store.append({ ...fullTierRecord(), userId: "alice" } as ProvenanceRecord);
    await store.append({ ...fullTierRecord(), userId: "bob" } as ProvenanceRecord);
    await store.append({ ...fullTierRecord() } as ProvenanceRecord); // no user

    expect(await store.query({ userId: "alice" })).toHaveLength(1);
    expect(await store.query({ userId: "bob" })).toHaveLength(1);
    expect(await store.query({ userId: "" })).toHaveLength(1);
    expect(await store.query({})).toHaveLength(3);
  });

  it("prune() removes records strictly older than the cutoff", async () => {
    await store.append({ ...fullTierRecord({ timestamp: "2020-01-01T00:00:00.000Z" }) } as ProvenanceRecord);
    await store.append({ ...fullTierRecord({ timestamp: "2026-01-01T00:00:00.000Z" }) } as ProvenanceRecord);

    const removed = await store.prune("2025-01-01T00:00:00.000Z");
    expect(removed).toBe(1);
    const left = await store.list();
    expect(left).toHaveLength(1);
    expect(left[0]!.timestamp).toBe("2026-01-01T00:00:00.000Z");
  });

  it("purge() deletes everything, or just one user's records", async () => {
    await store.append({ ...fullTierRecord(), userId: "alice" } as ProvenanceRecord);
    await store.append({ ...fullTierRecord(), userId: "bob" } as ProvenanceRecord);

    expect(await store.purge({ userId: "alice" })).toBe(1);
    expect(await store.list()).toHaveLength(1);

    await store.append({ ...fullTierRecord(), userId: "carol" } as ProvenanceRecord);
    expect(await store.purge()).toBe(2);
    expect(await store.list()).toHaveLength(0);
  });
});

describe("FileProvenanceStore persistence", () => {
  it("reads back records written by an earlier instance", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "swara-prov-"));
    const file = path.join(dir, "provenance.jsonl");

    const first = new FileProvenanceStore(file);
    const a = await first.append({ ...fullTierRecord() } as ProvenanceRecord);

    const second = new FileProvenanceStore(file);
    expect(await second.getById(a.id!)).toEqual(a);
  });
});

describe("ProvenanceLog facade", () => {
  it("stamps a timestamp when the caller omits it", async () => {
    const log = new ProvenanceLog(new InMemoryProvenanceStore());
    const rec = fullTierRecord();
    // @ts-expect-error — deliberately omit timestamp to test the fallback
    delete rec.timestamp;
    const stored = await log.record(rec);
    expect(stored?.timestamp).toBeTruthy();
    expect(Number.isNaN(Date.parse(stored!.timestamp))).toBe(false);
  });

  it("never throws into the caller when the store fails — returns undefined", async () => {
    const brokenStore: ProvenanceStore = {
      append: async () => {
        throw new Error("disk full");
      },
      getById: async () => undefined,
      query: async () => [],
      list: async () => [],
      prune: async () => 0,
      purge: async () => 0,
    };
    const log = new ProvenanceLog(brokenStore);
    await expect(log.record(fullTierRecord())).resolves.toBeUndefined();
  });

  it("recent() returns the N newest", async () => {
    const log = new ProvenanceLog(new InMemoryProvenanceStore());
    for (let i = 0; i < 4; i++) {
      await log.record(fullTierRecord({ timestamp: `2026-0${i + 1}-01T00:00:00.000Z` }));
    }
    const recent = await log.recent(2);
    expect(recent.map((r) => r.timestamp)).toEqual([
      "2026-04-01T00:00:00.000Z",
      "2026-03-01T00:00:00.000Z",
    ]);
  });

  it("redact mode stores structure + ids but not the transcript (F-06)", async () => {
    const store = new InMemoryProvenanceStore();
    const log = new ProvenanceLog(store, { redact: true });
    const stored = await log.record(
      fullTierRecord({
        meta: { rejectedCandidates: [{ text: "drifted phrasing", reason: "invented-severity" }] },
      }),
    );
    expect(stored!.finalApprovedText).toBe("[redacted]");
    expect(stored!.interpretationConfirmed?.text).toBe("[redacted]");
    expect(stored!.expressionOptionsShown.every((o) => o.text === "[redacted]")).toBe(true);
    expect(stored!.meta?.rejectedCandidates?.[0]?.text).toBe("[redacted]");
    // Structure is intact — concept ids, tier, the rejection *reason*.
    expect(stored!.concepts.map((c) => c.id)).toEqual(["doctor", "leg"]);
    expect(stored!.tierUsed).toBe("full");
    expect(stored!.meta?.rejectedCandidates?.[0]?.reason).toBe("invented-severity");
  });

  it("retention drops records past the window — on write and on demand (F-06)", async () => {
    const store = new InMemoryProvenanceStore();
    const log = new ProvenanceLog(store, { retentionDays: 30 });
    // The ancient record is pruned opportunistically the first time we write.
    await log.record(fullTierRecord({ timestamp: "2000-01-01T00:00:00.000Z" }));
    await log.record(fullTierRecord({ timestamp: new Date().toISOString() }));
    expect(await log.recent(10)).toHaveLength(1);

    // An explicit prune is also available (e.g. from a cron) and is a no-op here.
    expect(await log.pruneExpired()).toBe(0);

    // With retention disabled, nothing is dropped.
    const keep = new ProvenanceLog(new InMemoryProvenanceStore(), { retentionDays: 0 });
    await keep.record(fullTierRecord({ timestamp: "2000-01-01T00:00:00.000Z" }));
    expect(await keep.pruneExpired()).toBe(0);
    expect(await keep.recent(10)).toHaveLength(1);
  });

  it("purge() is exposed on the facade for the user-controlled deletion path (F-06)", async () => {
    const store = new InMemoryProvenanceStore();
    const log = new ProvenanceLog(store);
    await log.record({ ...fullTierRecord(), userId: "alice" });
    await log.record({ ...fullTierRecord(), userId: "bob" });
    expect(await log.purge({ userId: "alice" })).toBe(1);
    expect(await log.recent(10)).toHaveLength(1);
  });
});

describe("createProvenanceStore factory", () => {
  it("builds an in-memory store", () => {
    expect(createProvenanceStore({ backend: "memory" })).toBeInstanceOf(InMemoryProvenanceStore);
  });

  it("builds a file store when given a path", () => {
    expect(
      createProvenanceStore({ backend: "file", filePath: "./data/x.jsonl" }),
    ).toBeInstanceOf(FileProvenanceStore);
  });

  it("throws if file backend is requested without a path", () => {
    expect(() => createProvenanceStore({ backend: "file" })).toThrow();
  });
});
