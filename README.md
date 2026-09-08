# SWARA — project skeleton

AI-assisted AAC: **concepts → confirmed meaning → context-appropriate expression
→ speech**. AI helps with *how* something is said, never with *what* the user
means. Read [`../SWARA_KNOWLEDGE.md`](../SWARA_KNOWLEDGE.md) for the full product
model and [`../SPEC.md`](../SPEC.md) for the running architecture-decisions log.

> **Status: architecture pass.** Folder structure, shared types, endpoint stubs,
> and the frontend skeleton are in place. The Trust Ladder and Provenance
> libraries have **real, unit-tested logic**. Everything else is a documented
> stub for the Antigravity development pass.

## Layout

```
swara/
  shared/        @swara/shared — the only cross-cutting types (types.ts)
  backend/
    server.ts          thin Express adapter over the handlers below
    api/
      interpret/            POST /api/interpret            (stub + mock data)
      generate-expressions/ POST /api/generate-expressions (stub + mock data)
      tts/                  POST /api/tts                  (stub; Sarvam proxy, key server-side)
    lib/
      trust-ladder.ts   REAL tier state machine (full/fast/instant) + store + facade   [tested]
      provenance.ts     REAL storage-agnostic audit log + stores + factory             [tested]
      prompts.ts        shared MEANING_FIDELITY_CONSTRAINT + prompt builders           [tested]
      llm-client.ts     interpretation/generation model wrapper (mock + placeholder)
      sarvam-client.ts  Sarvam Bulbul TTS wrapper (mock + placeholder) + audio cache
      literal-mode.ts   deterministic no-AI rendering of concepts
      config.ts         tunable constants + env access
  frontend/        React + Vite skeleton — typed component contracts, flow state machine
```

## Getting started

```bash
npm install            # workspaces: shared, backend, frontend

cp .env.example .env    # optional; every value has a working default (mock mode)

npm test               # backend unit tests (trust-ladder, provenance, prompts)
npm run typecheck      # all three workspaces

npm run dev:backend    # http://localhost:8787  (GET /health to sanity-check)
npm run dev:frontend   # http://localhost:5173
```

With no API keys set, the backend runs fully offline: `/interpret` and
`/generate-expressions` return deterministic **fallback** data (labelled as such
in the response — `source: "fallback"`) and `/tts` returns a silent WAV. That is
intentional — the frontend can be wired against real response shapes immediately.

## Deployment (Features.md F-22)

The dev defaults are safe for `localhost` only. Before exposing the backend:

1. **Identity.** Set `SESSION_SECRET` to a strong random value. Without it the
   server keeps one shared Trust Ladder / audit log for everyone and **refuses to
   bind to a non-loopback `HOST`** (F-05).
2. **CORS.** Set `CORS_ORIGINS` to your frontend origin(s), comma-separated.
   Empty means "localhost dev only"; `*` is accepted but logged as unsafe.
3. **Rate limits.** `RATE_LIMIT_PER_MINUTE` / `RATE_LIMIT_BURST` cap the
   money-spending endpoints per IP and per device. Tune generously — AAC users
   legitimately send many short messages under stress.
4. **TLS.** This server speaks plain HTTP. Terminate TLS at a reverse proxy
   (nginx / Caddy / a managed load balancer) and forward to it on loopback;
   `trust proxy` is enabled so `X-Forwarded-For` drives the per-IP limiter.
5. **Provenance at rest.** `PROVENANCE_BACKEND=file` is the default. The JSON
   Lines file holds medical-symptom content — put it on an encrypted volume, set
   `PROVENANCE_RETENTION_DAYS` (default 90), and offer `PROVENANCE_REDACT=true`
   to users who want the accountability trail without the transcript. Users can
   wipe their own history via `POST /api/provenance/purge {"confirm": true}`.

## What each pipeline stage does here

| Stage | Does |
| --- | --- |
| **Claude Code — architecture** (this pass) | structure, types, stubs; real Trust Ladder + Provenance |
| **Antigravity — development** | real LLM + Sarvam calls; build the frontend loop; wire provenance into the speak path |
| **Claude Code — bug fixing** | verify meaning preservation, tier correctness, approval gating, provenance completeness |
| **UI/UX pass** | presentation of the Meaning Check and the speak action; accessibility |

Every stage **reads `../SPEC.md` first and appends to it before finishing.**
