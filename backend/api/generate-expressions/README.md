# `POST /api/generate-expressions`

Confirmed meaning + audience → **three** ways to say it. Step 4 of the core loop
(SWARA_KNOWLEDGE.md §6). Runs only *after* the Meaning Check.

## Contract

**Request** (`GenerateExpressionsRequest`, `shared/types.ts`):

```jsonc
{
  "confirmedIntent": "Doctor, the pain in my leg is worse.",
  "concepts": [ /* original concepts, for fidelity checking */ ],
  "audience": "doctor",          // manual selector value — free-form string
  "regenerate": false,           // true = user rejected the last set
  "previousOptions": []          // so a regenerate can avoid repeats
}
```

**Response** (`GenerateExpressionsResponse`):

```jsonc
{
  "options": [
    { "style": "Direct clinical report", "text": "Doctor, the pain in my leg is worse." },
    { "style": "Concise, with address",  "text": "Doctor, my leg pain is worse." },
    { "style": "Polite but clear",       "text": "Excuse me — the pain in my leg is worse." }
  ]
}
```

## Non-negotiables

- **Exactly 3 options.**
- **`style` is generated per message/audience.** There is no fixed label set.
  Do not reintroduce a `Blunt / Polite / Warm` constant (SWARA_KNOWLEDGE.md §6.4).
- **Meaning is identical across all 3** and identical to `confirmedIntent`.
  Adapting to `audience` changes tone and phrasing only — never urgency, detail,
  severity, or timeframe (SWARA_KNOWLEDGE.md §3, §8).

## Status

**Stub.** `handler.ts` returns deterministic mock data from `mock.ts`, which
derives dynamic style labels from the audience and only ever reframes the
confirmed intent with meaning-neutral wrappers.

## For the Antigravity pass

- Replace the mock call with a real LLM call using `buildExpressionPrompt()` from
  `lib/prompts.ts`.
- Add an explicit meaning-preservation check on the model output before
  returning (fail the request rather than speak drifted meaning). Test it against
  minimal 2-concept intents where a model is tempted to "help".
