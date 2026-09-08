# SWARA frontend

React + TypeScript + Vite. **Skeleton only** in this pass — typed component
contracts and an explicit flow state machine, with rendering and transitions
left as `TODO(antigravity)`.

## Layout

```
src/
  main.tsx              mount
  App.tsx               wires the loop together (skeleton)
  api-client.ts         the ONLY place that calls the backend (typed fetch wrappers)
  state/
    session-flow.ts     the core interaction loop as a state machine (types + reducer skeleton)
  components/
    ConceptGrid.tsx        step 1 — tap concept tiles
    AudienceSelector.tsx   the MANUAL audience picker (no auto-detection)
    InterpretationPanel.tsx step 3 — the Meaning Check (single + ranked A/B/C)
    ExpressionPicker.tsx   steps 5–8 — choose / edit / regenerate / literal mode
    SpeakButton.tsx        step 9 — the deliberate, user-initiated speak action
```

## Contracts that must not drift (see SWARA_KNOWLEDGE.md)

- **Nothing speaks without an explicit user gesture.** `SpeakButton` is the only
  component that triggers TTS for the full/fast flow; wire its `enabled` prop to
  `canSpeak(context)`, never to `true`. §6.9, §8.
- **Ambiguous interpretations render as a ranked shortlist**, never
  auto-resolved. §9a.
- **Expression `style` labels are dynamic** — render whatever the backend
  returns; no fixed Blunt/Polite/Warm mapping. §6.4.
- **Audience is chosen manually.** No silent inference. §12.

## Not in this pass

Caregiver/clinician dashboard, multilingual UI (only a language code is passed
through to TTS), any personalization beyond the Trust Ladder. See SPEC.md §6.

## Dev

```
npm install          # from /swara (workspace root)
npm run dev:backend  # http://localhost:8787
npm run dev:frontend # http://localhost:5173
```
