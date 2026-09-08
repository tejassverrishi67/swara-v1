import { describe, expect, it } from "vitest";
import {
  audioCacheKey,
  InMemoryAudioCache,
  MockSarvamClient,
} from "./sarvam-client.ts";

describe("sarvam-client", () => {
  it("derives deterministic cache keys", () => {
    const key1 = audioCacheKey({ text: "Help me", language: "en-IN", speaker: "anushka" });
    const key2 = audioCacheKey({ text: "Help me", language: "en-IN", speaker: "anushka" });
    const key3 = audioCacheKey({ text: "Water", language: "en-IN", speaker: "anushka" });

    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
  });

  it("stores and retrieves cached audio in InMemoryAudioCache", async () => {
    const cache = new InMemoryAudioCache();
    const key = "en-IN::anushka::Hello";

    expect(await cache.get(key)).toBeUndefined();

    await cache.set(key, {
      audioBase64: "dGVzdA==",
      mimeType: "audio/wav",
      cached: false,
      provider: "mock",
    });

    const hit = await cache.get(key);
    expect(hit).toBeDefined();
    expect(hit?.cached).toBe(true);
    expect(hit?.audioBase64).toBe("dGVzdA==");
  });

  it("MockSarvamClient caches instant-tier audio after first call", async () => {
    const cache = new InMemoryAudioCache();
    const client = new MockSarvamClient(cache);

    const req = {
      text: "I need help now.",
      language: "en-IN",
      speaker: "anushka",
      tier: "instant" as const,
    };

    // First call -> fresh
    const first = await client.synthesize(req);
    expect(first.cached).toBe(false);

    // Second call with same parameters on instant tier -> cached!
    const second = await client.synthesize(req);
    expect(second.cached).toBe(true);
    expect(second.audioBase64).toBe(first.audioBase64);
  });

  it("MockSarvamClient does not cache full-tier requests", async () => {
    const cache = new InMemoryAudioCache();
    const client = new MockSarvamClient(cache);

    const req = {
      text: "Doctor, my leg hurts.",
      language: "en-IN",
      speaker: "anushka",
      tier: "full" as const,
    };

    const first = await client.synthesize(req);
    expect(first.cached).toBe(false);

    const second = await client.synthesize(req);
    expect(second.cached).toBe(false);
  });

  it("synthesizeStreaming yields terminal audio chunk", async () => {
    const client = new MockSarvamClient();
    const chunks = [];

    for await (const chunk of client.synthesizeStreaming({
      text: "Testing streaming",
      language: "en-IN",
      speaker: "anushka",
      tier: "instant",
    })) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[chunks.length - 1]?.done).toBe(true);
  });
});
