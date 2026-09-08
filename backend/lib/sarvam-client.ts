/**
 * Sarvam Bulbul TTS client wrapper
 * ================================
 *
 * Wraps Sarvam AI's Bulbul text-to-speech model, chosen for Indian-language
 * quality that browser TTS cannot match (SWARA_KNOWLEDGE.md §13).
 *
 * Non-negotiables encoded here:
 *   - **The API key is server-side only.** This module reads it from the
 *     environment (via CONFIG) and it never appears in any value returned toward
 *     the frontend. The /tts endpoint exists precisely so the browser never
 *     holds this key.
 *   - **Two transports.** REST real-time for full/fast tier; WebSocket streaming
 *     for instant tier, where latency matters most.
 *   - **Instant-tier caching.** A pinned phrase should be synthesised once and
 *     replayed from cache on every subsequent use — no repeat API call.
 *
 * This pass ships a `MockSarvamClient` (returns a tiny silent WAV) so the whole
 * flow runs offline. `createSarvamClient()` returns the mock unless a real key is
 * present, in which case it returns a placeholder that throws — the real HTTP/WS
 * integration is the Antigravity development pass.
 *
 * Bulbul version (v2 vs v3/v3-beta) is still undecided — see SPEC.md §3d.
 */

import { CONFIG } from "./config.ts";
import type { TrustTier } from "@swara/shared";

/* ────────────────────────────────────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────────────────────────────────────── */

export interface SarvamSynthesizeRequest {
  text: string;
  /** Language code passed straight through to Sarvam, e.g. "en-IN", "hi-IN". */
  language: string;
  speaker: string;
  /**
   * Routing hint. "instant" -> streaming transport + cache; everything else ->
   * REST. The caller (the /tts handler) sets this from the Trust Ladder tier.
   */
  tier: TrustTier;
  /** Optional Bulbul-v2 prosody knobs. Ignored by v3/v3-beta and by the mock. */
  prosody?: { pitch?: number; loudness?: number; pace?: number };
}

export interface SarvamAudio {
  audioBase64: string;
  mimeType: string;
  /** True when this came from the instant-tier cache rather than a fresh synth. */
  cached: boolean;
  /** "sarvam-bulbul" for real synthesis, "mock" for the offline stand-in. */
  provider: "sarvam-bulbul" | "mock";
}

/** One chunk of a streaming synthesis (instant tier). */
export interface SarvamAudioChunk {
  audioBase64: string;
  mimeType: string;
  /** True on the final chunk. */
  done: boolean;
}

export interface SarvamClient {
  /** REST real-time synthesis. Used for full/fast tier. */
  synthesize(request: SarvamSynthesizeRequest): Promise<SarvamAudio>;
  /** WebSocket streaming synthesis. Used for instant tier. */
  synthesizeStreaming(request: SarvamSynthesizeRequest): AsyncIterable<SarvamAudioChunk>;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Instant-tier audio cache
 * ──────────────────────────────────────────────────────────────────────────── */

/** Cache key: identical text + language + speaker yields identical audio. */
export function audioCacheKey(r: Pick<SarvamSynthesizeRequest, "text" | "language" | "speaker">): string {
  return `${r.language}::${r.speaker}::${r.text}`;
}

/**
 * Minimal cache interface so the backing store (in-memory now, disk/CDN later)
 * can change without touching the client. Real logic, not a stub — instant tier
 * correctness depends on it.
 */
export interface AudioCache {
  get(key: string): Promise<SarvamAudio | undefined>;
  set(key: string, value: SarvamAudio): Promise<void>;
}

export class InMemoryAudioCache implements AudioCache {
  private readonly map = new Map<string, SarvamAudio>();
  async get(key: string): Promise<SarvamAudio | undefined> {
    const hit = this.map.get(key);
    return hit ? { ...hit, cached: true } : undefined;
  }
  async set(key: string, value: SarvamAudio): Promise<void> {
    this.map.set(key, { ...value, cached: false });
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Mock implementation
 * ──────────────────────────────────────────────────────────────────────────── */

/** 44-byte WAV header + no samples = a valid, silent, near-empty WAV file. */
const SILENT_WAV_BASE64 =
  "UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=";

/**
 * Offline stand-in. Returns the same silent clip for any input, but faithfully
 * exercises the tier routing and the instant-tier cache so those code paths are
 * covered before the real integration exists.
 */
export class MockSarvamClient implements SarvamClient {
  constructor(private readonly cache: AudioCache = new InMemoryAudioCache()) {}

  async synthesize(request: SarvamSynthesizeRequest): Promise<SarvamAudio> {
    if (request.tier === "instant") {
      const key = audioCacheKey(request);
      const hit = await this.cache.get(key);
      if (hit) return hit;
      const fresh = this.freshAudio();
      await this.cache.set(key, fresh);
      return fresh;
    }
    return this.freshAudio();
  }

  async *synthesizeStreaming(
    request: SarvamSynthesizeRequest,
  ): AsyncIterable<SarvamAudioChunk> {
    // The mock "streams" a single terminal chunk. Shape matches the real API's
    // contract closely enough to wire a player against.
    const audio = await this.synthesize({ ...request, tier: "instant" });
    yield { audioBase64: audio.audioBase64, mimeType: audio.mimeType, done: true };
  }

  private freshAudio(): SarvamAudio {
    return {
      audioBase64: SILENT_WAV_BASE64,
      mimeType: "audio/wav",
      cached: false,
      provider: "mock",
    };
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Real client (placeholder)
 * ──────────────────────────────────────────────────────────────────────────── */

/* ────────────────────────────────────────────────────────────────────────────
 * Real client implementation
 * ──────────────────────────────────────────────────────────────────────────── */

export class RealSarvamClient implements SarvamClient {
  constructor(private readonly cache: AudioCache = sharedAudioCache) {}

  async synthesize(request: SarvamSynthesizeRequest): Promise<SarvamAudio> {
    // Instant-tier caching: pinned phrases must not re-hit Sarvam
    if (request.tier === "instant") {
      const key = audioCacheKey(request);
      const hit = await this.cache.get(key);
      if (hit) return hit;

      const fresh = await this.callRestApi(request);
      await this.cache.set(key, fresh);
      return fresh;
    }

    return this.callRestApi(request);
  }

  private async callRestApi(request: SarvamSynthesizeRequest): Promise<SarvamAudio> {
    const model = CONFIG.sarvam.model.includes(":") ? CONFIG.sarvam.model : `bulbul:${CONFIG.sarvam.model}`;
    const payload: Record<string, unknown> = {
      inputs: [request.text],
      target_language_code: request.language || "en-IN",
      speaker: request.speaker || "anushka",
      model,
      pitch: request.prosody?.pitch ?? 0,
      pace: request.prosody?.pace ?? 1.0,
      loudness: request.prosody?.loudness ?? 1.0,
      speech_sample_rate: 22050,
      enable_preprocessing: true,
    };

    const response = await fetch(CONFIG.sarvam.endpoints.rest, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": CONFIG.sarvam.apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Sarvam TTS REST API error (${response.status}): ${errText}`);
    }

    // Sarvam's REST response has historically been { audios: ["<base64>"] };
    // accept a couple of near-variants defensively so a shape tweak surfaces as
    // real audio, not a silent failure.
    const data = (await response.json()) as {
      audios?: unknown;
      audio?: unknown;
      output?: { audios?: unknown };
    };
    const fromArray = (v: unknown): string | undefined =>
      Array.isArray(v) && typeof v[0] === "string" && v[0].length > 0 ? v[0] : undefined;
    const audioBase64 =
      fromArray(data.audios) ??
      fromArray(data.output?.audios) ??
      (typeof data.audio === "string" && data.audio.length > 0 ? data.audio : undefined);
    if (!audioBase64) {
      throw new Error(
        `Sarvam TTS returned no audio. Response keys: [${Object.keys(data).join(", ") || "none"}].`,
      );
    }

    return {
      audioBase64,
      mimeType: "audio/wav",
      cached: false,
      provider: "sarvam-bulbul",
    };
  }

  async *synthesizeStreaming(
    request: SarvamSynthesizeRequest,
  ): AsyncIterable<SarvamAudioChunk> {
    // If audio is already cached for instant tier, yield complete cached chunk
    if (request.tier === "instant") {
      const key = audioCacheKey(request);
      const hit = await this.cache.get(key);
      if (hit) {
        yield { audioBase64: hit.audioBase64, mimeType: hit.mimeType, done: true };
        return;
      }
    }

    // Check if WebSocket is supported in the current environment
    if (typeof globalThis.WebSocket !== "undefined") {
      try {
        const wsUrl = new URL(CONFIG.sarvam.endpoints.websocket);
        const ws = new globalThis.WebSocket(wsUrl.toString(), {
          headers: { "api-subscription-key": CONFIG.sarvam.apiKey },
        } as unknown as string[]);

        // Wait for connection
        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => resolve();
          ws.onerror = (e) => reject(new Error(`WebSocket error: ${String(e)}`));
        });

        // Send initial config and text
        const model = CONFIG.sarvam.model.includes(":") ? CONFIG.sarvam.model : `bulbul:${CONFIG.sarvam.model}`;
        ws.send(
          JSON.stringify({
            type: "config",
            data: {
              target_language_code: request.language || "en-IN",
              speaker: request.speaker || "anushka",
              model,
            },
          }),
        );
        ws.send(JSON.stringify({ type: "text", data: { text: request.text } }));

        // Stream incoming messages using an async queue
        const chunks: SarvamAudioChunk[] = [];
        let done = false;
        let resolveNext: (() => void) | null = null;

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(String(event.data)) as {
              type?: string;
              data?: { audio?: string };
            };
            if (msg.type === "audio" && msg.data?.audio) {
              chunks.push({ audioBase64: msg.data.audio, mimeType: "audio/wav", done: false });
              resolveNext?.();
            } else if (msg.type === "done" || msg.type === "complete") {
              chunks.push({ audioBase64: "", mimeType: "audio/wav", done: true });
              done = true;
              resolveNext?.();
              ws.close();
            }
          } catch {
            // ignore parse errors
          }
        };

        ws.onclose = () => {
          done = true;
          resolveNext?.();
        };

        while (!done || chunks.length > 0) {
          if (chunks.length > 0) {
            yield chunks.shift()!;
          } else if (!done) {
            await new Promise<void>((res) => {
              resolveNext = res;
            });
          }
        }
        return;
      } catch (wsErr) {
        console.warn("[sarvam-client] WebSocket streaming failed, falling back to REST:", wsErr);
      }
    }

    // Fallback to REST synthesis if WS streaming is unavailable or fails
    const audio = await this.synthesize(request);
    yield { audioBase64: audio.audioBase64, mimeType: audio.mimeType, done: true };
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Factory
 * ──────────────────────────────────────────────────────────────────────────── */

/** Shared cache instance so instant-tier hits persist across requests in one process. */
const sharedAudioCache: AudioCache = new InMemoryAudioCache();

export function createSarvamClient(cache: AudioCache = sharedAudioCache): SarvamClient {
  if (CONFIG.sarvam.enabled) {
    return new RealSarvamClient(cache);
  }
  return new MockSarvamClient(cache);
}

