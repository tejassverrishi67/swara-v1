/**
 * Provenance layer — accountability log
 * =====================================
 *
 * Every spoken message, in every tier, is silently logged so that "what actually
 * happened" can be reconstructed later — for the user ("say that again") or, with
 * the user's consent, for clinician review (SWARA_KNOWLEDGE.md §9c). SWARA is
 * used for medical symptom reporting; being able to reconstruct a message after
 * the fact is a real requirement, not an optional audit feature.
 *
 * Design constraints baked in here:
 *   - **Storage-agnostic.** Callers depend on the {@link ProvenanceStore}
 *     interface only. `InMemoryProvenanceStore` and `FileProvenanceStore` ship
 *     now; a DB adapter later drops in behind the same interface with zero caller
 *     changes.
 *   - **Never blocks the user-facing flow.** {@link ProvenanceLog.record} does
 *     the write on the caller's behalf but callers should treat it as
 *     fire-and-forget (`void log.record(...)`), and {@link ProvenanceLog} catches
 *     and reports store errors rather than throwing into the speak path.
 *   - **Write + read.** Reads exist to support "say that again" and future
 *     consented review. No read *endpoint* is exposed yet (SPEC.md §4).
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { ProvenanceRecord } from "@swara/shared";

/* ────────────────────────────────────────────────────────────────────────────
 * Store interface
 * ──────────────────────────────────────────────────────────────────────────── */

/** Filter for {@link ProvenanceStore.query}. All fields optional; AND-combined. */
export interface ProvenanceQuery {
  /** Match records whose concept id set exactly equals this set (order-independent). */
  conceptIds?: string[];
  /** Match only records for this device/session (Features.md F-05). */
  userId?: string;
  /** Inclusive lower bound on `timestamp` (ISO 8601). */
  from?: string;
  /** Inclusive upper bound on `timestamp` (ISO 8601). */
  to?: string;
  /** Cap the number of results (most recent first). */
  limit?: number;
}

/**
 * Storage-agnostic persistence for provenance records.
 *
 * Implementations must:
 *   - assign a unique `id` on `append` if the incoming record has none, and
 *     return the stored record (with `id` populated);
 *   - return records from `query`/`list` sorted **most recent first**.
 */
export interface ProvenanceStore {
  append(record: ProvenanceRecord): Promise<ProvenanceRecord>;
  getById(id: string): Promise<ProvenanceRecord | undefined>;
  query(filter: ProvenanceQuery): Promise<ProvenanceRecord[]>;
  list(limit?: number): Promise<ProvenanceRecord[]>;
  /**
   * Remove records whose `timestamp` is strictly before `beforeIso`. Returns the
   * count removed. Supports the retention policy (Features.md F-06).
   */
  prune(beforeIso: string): Promise<number>;
  /**
   * Delete records — all of them, or just one user's (Features.md F-06: "a
   * documented deletion path the user controls"). Returns the count removed.
   */
  purge(filter?: { userId?: string }): Promise<number>;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Shared helpers
 * ──────────────────────────────────────────────────────────────────────────── */

function conceptIdSet(record: ProvenanceRecord): string {
  return record.concepts
    .map((c) => c.id)
    .slice()
    .sort()
    .join("+");
}

function matches(record: ProvenanceRecord, filter: ProvenanceQuery): boolean {
  if (filter.conceptIds) {
    const want = filter.conceptIds.slice().sort().join("+");
    if (conceptIdSet(record) !== want) return false;
  }
  if (filter.userId !== undefined && (record.userId ?? "") !== filter.userId) return false;
  if (filter.from && record.timestamp < filter.from) return false;
  if (filter.to && record.timestamp > filter.to) return false;
  return true;
}

/** Newest first. */
function byTimestampDesc(a: ProvenanceRecord, b: ProvenanceRecord): number {
  return a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0;
}

/** Fill in `id` (and nothing else) if missing. Does not mutate the input. */
function withId(record: ProvenanceRecord): ProvenanceRecord {
  return record.id ? { ...record } : { ...record, id: randomUUID() };
}

/* ────────────────────────────────────────────────────────────────────────────
 * In-memory implementation
 * ──────────────────────────────────────────────────────────────────────────── */

export class InMemoryProvenanceStore implements ProvenanceStore {
  private readonly records: ProvenanceRecord[] = [];

  async append(record: ProvenanceRecord): Promise<ProvenanceRecord> {
    const stored = withId(record);
    this.records.push(stored);
    return { ...stored };
  }

  async getById(id: string): Promise<ProvenanceRecord | undefined> {
    const found = this.records.find((r) => r.id === id);
    return found ? { ...found } : undefined;
  }

  async query(filter: ProvenanceQuery): Promise<ProvenanceRecord[]> {
    const out = this.records
      .filter((r) => matches(r, filter))
      .sort(byTimestampDesc)
      .map((r) => ({ ...r }));
    return filter.limit != null ? out.slice(0, filter.limit) : out;
  }

  async list(limit?: number): Promise<ProvenanceRecord[]> {
    const out = this.records.slice().sort(byTimestampDesc).map((r) => ({ ...r }));
    return limit != null ? out.slice(0, limit) : out;
  }

  async prune(beforeIso: string): Promise<number> {
    const before = this.records.length;
    for (let i = this.records.length - 1; i >= 0; i--) {
      if (this.records[i]!.timestamp < beforeIso) this.records.splice(i, 1);
    }
    return before - this.records.length;
  }

  async purge(filter?: { userId?: string }): Promise<number> {
    if (!filter || filter.userId === undefined) {
      const n = this.records.length;
      this.records.length = 0;
      return n;
    }
    const before = this.records.length;
    for (let i = this.records.length - 1; i >= 0; i--) {
      if ((this.records[i]!.userId ?? "") === filter.userId) this.records.splice(i, 1);
    }
    return before - this.records.length;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * JSON Lines file implementation
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Append-only JSON Lines file: one {@link ProvenanceRecord} per line. Append is
 * a single `appendFile` call (cheap, and append-only keeps the audit trail
 * tamper-evident-ish). Reads parse the whole file — fine at the scale of one
 * user's message history; a DB adapter replaces this when that stops being true.
 */
export class FileProvenanceStore implements ProvenanceStore {
  constructor(private readonly filePath: string) {}

  private async readAll(): Promise<ProvenanceRecord[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return raw
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as ProvenanceRecord);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  async append(record: ProvenanceRecord): Promise<ProvenanceRecord> {
    const stored = withId(record);
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.appendFile(this.filePath, `${JSON.stringify(stored)}\n`, "utf8");
    return { ...stored };
  }

  async getById(id: string): Promise<ProvenanceRecord | undefined> {
    return (await this.readAll()).find((r) => r.id === id);
  }

  async query(filter: ProvenanceQuery): Promise<ProvenanceRecord[]> {
    const out = (await this.readAll())
      .filter((r) => matches(r, filter))
      .sort(byTimestampDesc);
    return filter.limit != null ? out.slice(0, filter.limit) : out;
  }

  async list(limit?: number): Promise<ProvenanceRecord[]> {
    const out = (await this.readAll()).sort(byTimestampDesc);
    return limit != null ? out.slice(0, limit) : out;
  }

  private async rewrite(records: ProvenanceRecord[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const body = records.map((r) => JSON.stringify(r)).join("\n");
    await fs.writeFile(this.filePath, body.length > 0 ? `${body}\n` : "", "utf8");
  }

  async prune(beforeIso: string): Promise<number> {
    const all = await this.readAll();
    const kept = all.filter((r) => r.timestamp >= beforeIso);
    if (kept.length === all.length) return 0;
    await this.rewrite(kept);
    return all.length - kept.length;
  }

  async purge(filter?: { userId?: string }): Promise<number> {
    const all = await this.readAll();
    if (!filter || filter.userId === undefined) {
      if (all.length === 0) return 0;
      await this.rewrite([]);
      return all.length;
    }
    const kept = all.filter((r) => (r.userId ?? "") !== filter.userId);
    if (kept.length === all.length) return 0;
    await this.rewrite(kept);
    return all.length - kept.length;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Facade
 * ──────────────────────────────────────────────────────────────────────────── */

/** Input to {@link ProvenanceLog.record} — a record without the store-assigned `id`. */
export type NewProvenanceRecord = Omit<ProvenanceRecord, "id">;

/**
 * Structural check for an incoming {@link NewProvenanceRecord}. Returns a list of
 * human-readable problems (empty when the record is well-formed).
 *
 * This exists because the write path is silent and the audit trail has to be
 * trustworthy (SWARA_KNOWLEDGE.md §9c): a record missing `concepts` or
 * `finalApprovedText` is worse than useless, so the HTTP endpoint rejects it
 * rather than persisting a hole in the log. `timestamp` is intentionally NOT
 * required here — {@link ProvenanceLog.record} stamps it when absent.
 *
 * Note: `interpretationConfirmed` is now always `null` (the flow has no manual
 * confirmation step), and for the `instant` tier `interpretationsShown` /
 * `expressionOptionsShown` are also `[]` — all valid.
 */
export function validateNewProvenanceRecord(body: unknown): string[] {
  const problems: string[] = [];
  if (typeof body !== "object" || body === null) {
    return ["body must be a JSON object"];
  }
  const r = body as Record<string, unknown>;

  if (!Array.isArray(r.concepts) || r.concepts.length === 0) {
    problems.push("`concepts` must be a non-empty array");
  }
  if (!Array.isArray(r.interpretationsShown)) {
    problems.push("`interpretationsShown` must be an array");
  }
  if (!("interpretationConfirmed" in r) || r.interpretationConfirmed === undefined) {
    // must be present; is always null now (no manual confirmation step)
    problems.push("`interpretationConfirmed` must be present (object or null)");
  }
  if (r.tierUsed !== "full" && r.tierUsed !== "fast" && r.tierUsed !== "instant") {
    problems.push('`tierUsed` must be "full" | "fast" | "instant"');
  }
  if (!Array.isArray(r.expressionOptionsShown)) {
    problems.push("`expressionOptionsShown` must be an array");
  }
  if (typeof r.finalApprovedText !== "string" || r.finalApprovedText.trim() === "") {
    problems.push("`finalApprovedText` must be a non-empty string");
  }
  if (typeof r.wasManuallyEdited !== "boolean") {
    problems.push("`wasManuallyEdited` must be a boolean");
  }
  return problems;
}

/**
 * The object the rest of the backend talks to. Wraps a {@link ProvenanceStore}
 * and:
 *   - stamps `timestamp` if the caller did not (defensive; callers should pass
 *     the real speak time),
 *   - swallows and logs store errors so a failed write never propagates into the
 *     user's speak path.
 */
export interface ProvenanceLogOptions {
  /** Records older than this many days are pruned opportunistically. 0 disables (F-06). */
  retentionDays?: number;
  /** Strip the transcript (final text + interpretation/expression strings) before storing (F-06). */
  redact?: boolean;
}

/** Replace human-readable text with a marker, keeping ids and structure (F-06 redact mode). */
export function redactRecord(record: ProvenanceRecord): ProvenanceRecord {
  const R = "[redacted]";
  return {
    ...record,
    interpretationsShown: record.interpretationsShown.map((i) => ({ ...i, text: R })),
    interpretationConfirmed: record.interpretationConfirmed
      ? { ...record.interpretationConfirmed, text: R }
      : null,
    expressionOptionsShown: record.expressionOptionsShown.map((o) => ({ ...o, text: R })),
    finalApprovedText: R,
    meta: record.meta
      ? { ...record.meta, rejectedCandidates: record.meta.rejectedCandidates?.map((c) => ({ ...c, text: R })) }
      : undefined,
  };
}

export class ProvenanceLog {
  private readonly retentionDays: number;
  private readonly redact: boolean;
  private lastPruneAt = 0;

  constructor(private readonly store: ProvenanceStore, options: ProvenanceLogOptions = {}) {
    this.retentionDays = options.retentionDays ?? 0;
    this.redact = options.redact ?? false;
  }

  /**
   * Record one spoken message. Fire-and-forget from the caller's perspective:
   * `void provenance.record({...})`. Resolves to the stored record (with `id`)
   * on success, or `undefined` if the write failed (the failure is logged, not
   * thrown).
   */
  async record(record: NewProvenanceRecord): Promise<ProvenanceRecord | undefined> {
    try {
      let complete: ProvenanceRecord = {
        ...record,
        timestamp: record.timestamp || new Date().toISOString(),
      };
      if (this.redact) complete = redactRecord(complete);
      const stored = await this.store.append(complete);
      void this.maybePrune();
      return stored;
    } catch (err) {
      // Never let provenance failure break communication. Surface it for the
      // debugging pass instead.
      console.error("[provenance] failed to write record:", err);
      return undefined;
    }
  }

  /** Prune expired records at most once an hour, off the write path. */
  private async maybePrune(): Promise<void> {
    if (this.retentionDays <= 0) return;
    const now = Date.now();
    if (now - this.lastPruneAt < 60 * 60 * 1000) return;
    this.lastPruneAt = now;
    try {
      const cutoff = new Date(now - this.retentionDays * 24 * 60 * 60 * 1000).toISOString();
      const removed = await this.store.prune(cutoff);
      if (removed > 0) console.log(`[provenance] pruned ${removed} record(s) older than ${this.retentionDays}d`);
    } catch (err) {
      console.error("[provenance] prune failed:", err);
    }
  }

  /** Force a retention prune now (used by an operational endpoint / cron). */
  pruneExpired(): Promise<number> {
    if (this.retentionDays <= 0) return Promise.resolve(0);
    const cutoff = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000).toISOString();
    return this.store.prune(cutoff);
  }

  /** User-controlled deletion (F-06). Scope to a userId, or omit to wipe everything. */
  purge(filter?: { userId?: string }): Promise<number> {
    return this.store.purge(filter);
  }

  /** Look up a single record — supports "say that again". */
  getById(id: string): Promise<ProvenanceRecord | undefined> {
    return this.store.getById(id);
  }

  /** Query records — supports consented review tooling built later. */
  query(filter: ProvenanceQuery = {}): Promise<ProvenanceRecord[]> {
    return this.store.query(filter);
  }

  /** Most recent `limit` records. */
  recent(limit = 20): Promise<ProvenanceRecord[]> {
    return this.store.list(limit);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Factory
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ProvenanceStoreConfig {
  backend: "memory" | "file";
  /** Required when `backend === "file"`. */
  filePath?: string;
}

/**
 * Build a {@link ProvenanceStore} from config. This is the seam that keeps every
 * caller storage-agnostic: change `PROVENANCE_BACKEND` in the environment and
 * nothing else moves.
 */
export function createProvenanceStore(config: ProvenanceStoreConfig): ProvenanceStore {
  switch (config.backend) {
    case "file":
      if (!config.filePath) {
        throw new Error('createProvenanceStore: filePath is required when backend is "file"');
      }
      return new FileProvenanceStore(config.filePath);
    case "memory":
      return new InMemoryProvenanceStore();
    default: {
      const exhaustive: never = config.backend;
      throw new Error(`createProvenanceStore: unknown backend ${String(exhaustive)}`);
    }
  }
}
