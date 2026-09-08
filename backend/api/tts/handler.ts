/**
 * POST /api/tts
 * =============
 *
 * Input:  { text, language, speaker, tier }   (TtsRequest)
 * Output: { audioBase64, mimeType, cached, provider }   (TtsResponse)
 *
 * The single server-side proxy in front of Sarvam Bulbul. Its reason to exist:
 * the Sarvam API key stays here and never reaches the browser
 * (SWARA_KNOWLEDGE.md §13). The frontend calls this endpoint; this endpoint
 * calls Sarvam.
 *
 * Tier routing (from the Trust Ladder result the frontend passes in):
 *   - "full" / "fast" -> REST real-time synthesis
 *   - "instant"       -> streaming synthesis + audio cache (repeat pinned
 *                        phrases must not re-hit the API)
 *
 * STATUS: stub. With no SARVAM_API_KEY set, `createSarvamClient()` returns a mock
 * that yields a short silent WAV but faithfully exercises tier routing and the
 * instant-tier cache. Real HTTP/WS integration is the Antigravity pass.
 *
 * This endpoint does NOT decide whether speaking is allowed. Approval gating
 * (explicit user approval, or a legitimately pinned instant phrase) is enforced
 * by the caller / flow. This handler only synthesises the text it is given.
 */

import type { TtsRequest, TtsResponse } from "@swara/shared";
import { createSarvamClient } from "../../lib/sarvam-client.ts";

/** Thrown for malformed input; server.ts maps this to HTTP 400. */
export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRequestError";
  }
}

const VALID_TIERS = new Set(["full", "fast", "instant"]);

export function parseTtsRequest(body: unknown): TtsRequest {
  if (typeof body !== "object" || body === null) {
    throw new InvalidRequestError("Body must be a JSON object.");
  }
  const b = body as Record<string, unknown>;

  if (typeof b.text !== "string" || b.text.trim() === "") {
    throw new InvalidRequestError("`text` must be a non-empty string.");
  }
  if (typeof b.language !== "string" || b.language.trim() === "") {
    throw new InvalidRequestError("`language` must be a non-empty string (passed to Sarvam).");
  }
  if (typeof b.speaker !== "string" || b.speaker.trim() === "") {
    throw new InvalidRequestError("`speaker` must be a non-empty string.");
  }
  if (typeof b.tier !== "string" || !VALID_TIERS.has(b.tier)) {
    throw new InvalidRequestError('`tier` must be one of "full" | "fast" | "instant".');
  }

  return {
    text: b.text,
    language: b.language,
    speaker: b.speaker,
    tier: b.tier as TtsRequest["tier"],
  };
}

/**
 * Synthesise speech for already-approved text.
 *
 * Instant tier uses the non-streaming `synthesize` path here (which is
 * cache-backed in the client) so this JSON endpoint can return a single payload.
 * A separate streaming transport for instant tier — Server-Sent Events or a
 * WebSocket bridging to Sarvam's WS endpoint — is a follow-up for the Antigravity
 * pass; the client already exposes `synthesizeStreaming` for it.
 */
export async function synthesizeSpeech(request: TtsRequest): Promise<TtsResponse> {
  const sarvam = createSarvamClient();
  const audio = await sarvam.synthesize({
    text: request.text,
    language: request.language,
    speaker: request.speaker,
    tier: request.tier,
  });

  return {
    audioBase64: audio.audioBase64,
    mimeType: audio.mimeType,
    cached: audio.cached,
    provider: audio.provider,
  };
}
