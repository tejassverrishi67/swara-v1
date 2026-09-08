/**
 * Typed fetch wrappers for the three SWARA backend endpoints.
 * ==========================================================
 *
 * This is the ONLY place the frontend talks to the backend. Components import
 * these functions; they never call `fetch` directly. The TTS endpoint is a proxy
 * — the browser never holds the Sarvam key (SWARA_KNOWLEDGE.md §13).
 *
 * `VITE_API_BASE` selects the backend origin (see ../../.env.example).
 */

import type {
  GenerateExpressionsRequest,
  GenerateExpressionsResponse,
  InterpretRequest,
  InterpretationResult,
  TtsRequest,
  TtsResponse,
  ApiError,
} from "@swara/shared";

const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ??
  "http://localhost:8787";

/** Thrown when the backend returns a non-2xx response. Carries the parsed ApiError. */
export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiError | undefined,
  ) {
    super(body?.error?.message ?? `Request failed with status ${status}`);
    this.name = "ApiRequestError";
  }
}

async function postJson<TReq, TRes>(path: string, payload: TReq): Promise<TRes> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let body: ApiError | undefined;
    try {
      body = (await res.json()) as ApiError;
    } catch {
      body = undefined;
    }
    throw new ApiRequestError(res.status, body);
  }
  return (await res.json()) as TRes;
}

async function getJson<TRes>(path: string): Promise<TRes> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { accept: "application/json" } });
  if (!res.ok) {
    let body: ApiError | undefined;
    try {
      body = (await res.json()) as ApiError;
    } catch {
      body = undefined;
    }
    throw new ApiRequestError(res.status, body);
  }
  return (await res.json()) as TRes;
}

/** Step 2 of the loop: concepts -> ranked interpretation(s). */
export function interpret(req: InterpretRequest): Promise<InterpretationResult> {
  return postJson<InterpretRequest, InterpretationResult>("/api/interpret", req);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Voices + languages (Features.md F-13 / F-14)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface VoiceInfo {
  id: string;
  name: string;
  gender: "female" | "male" | "unknown";
  versions: string[];
  languages: string[];
  description: string;
}

export interface LanguageInfo {
  code: string;
  name: string;
  endonym: string;
}

export interface VoicesResponse {
  model: string;
  defaultSpeaker: string;
  defaultLanguage: string;
  voices: VoiceInfo[];
  languages: LanguageInfo[];
}

/** Voices valid for the configured Bulbul model + the languages it supports. */
export function getVoices(): Promise<VoicesResponse> {
  return getJson<VoicesResponse>("/api/voices");
}

/* ────────────────────────────────────────────────────────────────────────────
 * Concept palettes (Features.md F-10)
 * ──────────────────────────────────────────────────────────────────────────── */

/** The concept tiles the app offers, as one unified set (no switchable boards). */
export function getPalettes(): Promise<PalettesResponse> {
  return getJson<PalettesResponse>("/api/palettes");
}

/** Step 4: confirmed intent + inferred tone -> exactly 3 expression options. */
export function generateExpressions(
  req: GenerateExpressionsRequest,
): Promise<GenerateExpressionsResponse> {
  return postJson<GenerateExpressionsRequest, GenerateExpressionsResponse>(
    "/api/generate-expressions",
    req,
  );
}

/**
 * Step 9: approved text -> audio. Call ONLY after explicit user approval, or for
 * a legitimately pinned instant-tier phrase. This function does not — and must
 * not be made to — enforce that; the flow does (see state/session-flow.ts).
 */
export function synthesizeSpeech(req: TtsRequest): Promise<TtsResponse> {
  return postJson<TtsRequest, TtsResponse>("/api/tts", req);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Trust Ladder endpoints
 * ──────────────────────────────────────────────────────────────────────────── */

import type {
  Concept,
  PalettesResponse,
  ProvenanceRecord,
  TrustLadderEntry,
  TrustTier,
} from "@swara/shared";

export interface TrustLadderStatusResponse {
  tier: TrustTier;
  explanation: { tier: TrustTier; reason: string };
  entry?: TrustLadderEntry;
}

export function getTrustLadderStatus(concepts: Concept[]): Promise<TrustLadderStatusResponse> {
  return postJson<{ concepts: Concept[] }, TrustLadderStatusResponse>("/api/trust-ladder/status", { concepts });
}

export function confirmTrustLadder(
  concepts: Concept[],
  confirmedInterpretation: string,
): Promise<{ entry: TrustLadderEntry }> {
  return postJson<{ concepts: Concept[]; confirmedInterpretation: string }, { entry: TrustLadderEntry }>(
    "/api/trust-ladder/confirm",
    { concepts, confirmedInterpretation },
  );
}

export function pinToInstant(
  concepts: Concept[],
  pinnedText: string,
): Promise<{ entry: TrustLadderEntry }> {
  return postJson<{ concepts: Concept[]; pinnedText: string }, { entry: TrustLadderEntry }>(
    "/api/trust-ladder/pin",
    { concepts, pinnedText },
  );
}

export function unpinFromInstant(concepts: Concept[]): Promise<{ entry?: TrustLadderEntry }> {
  return postJson<{ concepts: Concept[] }, { entry?: TrustLadderEntry }>("/api/trust-ladder/unpin", { concepts });
}

/* ────────────────────────────────────────────────────────────────────────────
 * Provenance silent log
 * ──────────────────────────────────────────────────────────────────────────── */

export function logProvenance(record: Omit<ProvenanceRecord, "id">): Promise<{ ok: boolean; id?: string }> {
  return postJson<Omit<ProvenanceRecord, "id">, { ok: boolean; id?: string }>("/api/provenance/log", record);
}

