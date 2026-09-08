# `POST /api/interpret`

Concepts in → ranked candidate meaning(s) out. This is step 2 of the core loop
(SWARA_KNOWLEDGE.md §6).

## Contract

**Request** (`InterpretRequest`, `shared/types.ts`):

```jsonc
{
  "concepts": [
    { "id": "doctor", "emoji": "👨‍⚕️", "label": "doctor" },
    { "id": "leg",    "emoji": "🦵",   "label": "leg" },
    { "id": "pain",   "emoji": "😣",   "label": "pain" },
    { "id": "worse",  "emoji": "📈",   "label": "worse" }
  ]
}
```

**Response** (`InterpretationResult`):

```jsonc
{
  "concepts": [ /* echo of input */ ],
  "interpretations": [
    { "text": "Doctor, the pain in my leg is worse.", "confidence": 0.92 }
  ]
}
```

- `interpretations` is **ranked, most likely first**.
- Length **1** when the top reading is clearly dominant.
- Length **2–3** when ambiguous — the UI must show this as an A/B/C shortlist
  with an "add another concept to clarify" path, never silently pick #1
  (SWARA_KNOWLEDGE.md §9a).

## Status

**Stub.** `handler.ts` returns deterministic mock data from `mock.ts`. Curated
combos (`doctor+leg+pain+worse`, `help+now`, `cold+feel`, `tired+you`, …)
exercise both the single and the ranked paths.

## For the Antigravity pass

- Replace the mock call in `handler.ts::interpret` with a real LLM call.
- Use `buildInterpretationPrompt()` from `lib/prompts.ts`. It carries
  `MEANING_FIDELITY_CONSTRAINT`. **Do not** write a prompt inline here — that is
  exactly how the constraint gets dropped.
- Apply the `INTERPRETATION` thresholds in `lib/config.ts` to decide single vs.
  shortlist.
- Every returned string must be traceable to the input concepts. No invented
  severity, timeframe, quantity, cause, or request.
