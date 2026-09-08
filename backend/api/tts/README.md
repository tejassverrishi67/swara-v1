# `POST /api/tts`

Approved text → audio. Step 9 of the core loop (SWARA_KNOWLEDGE.md §6). The
**only** server-side proxy in front of Sarvam Bulbul.

## Why this endpoint exists

So the **Sarvam API key never reaches the browser**. The frontend calls `/api/tts`;
`/api/tts` calls Sarvam with the key read from `SARVAM_API_KEY` (server env only).
The key must not appear in any response body, any client-visible header, or any
frontend bundle (SWARA_KNOWLEDGE.md §13; verified in the bug-fixing pass,
SWARA_MASTER_PROMPTS.md Prompt 3 §6).

## Contract

**Request** (`TtsRequest`, `shared/types.ts`):

```jsonc
{
  "text": "Doctor, the pain in my leg is worse.",
  "language": "en-IN",   // passed straight through to Sarvam
  "speaker": "anushka",
  "tier": "full"          // "full" | "fast" | "instant" — from the Trust Ladder
}
```

**Response** (`TtsResponse`):

```jsonc
{ "audioBase64": "…", "mimeType": "audio/wav", "cached": false, "provider": "mock" }
```

## Tier routing

| Tier            | Transport                        | Cache                          |
| --------------- | -------------------------------- | ------------------------------ |
| `full` / `fast` | Sarvam REST real-time endpoint   | none                           |
| `instant`       | Sarvam WS streaming endpoint     | yes — synthesize once, replay  |

The instant-tier cache (`lib/sarvam-client.ts`, `AudioCache`) means a pinned
phrase like "I need help" is synthesised once and served from memory thereafter.

## Not this endpoint's job

**Approval gating.** Whether a given text is *allowed* to be spoken (explicit user
approval, or a legitimately pinned instant-tier phrase) is enforced by the flow
that calls this endpoint, not here. This handler synthesises whatever approved
text it is hanhed.

## Status

**Stub.** No `SARVAM_API_KEY` → `MockSarvamClient` returns a silent WAV while
still exercising tier routing and the cache. Real REST + WS integration, Bulbul
version selection (SPEC.md §3d), and a streaming transport for instant tier are
the Antigravity pass.
