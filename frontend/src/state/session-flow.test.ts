/**
 * Session-flow safety-invariant tests for the 2-action flow.
 *
 * The reducer + `canSpeak` guard are where the product's safety-critical rules
 * live on the client:
 *  - `speaking` is reachable ONLY via `previewing` (entered by an explicit
 *    `CHOOSE_EMOTION`), or straight from `selecting` for a user-pinned instant
 *    phrase. No other path.
 *  - Nothing in the reducer ever produces `tier: "instant"` — only `SET_TIER`.
 *  - A concept / language change wipes every derived suggestion so a stale one
 *    can never ride into a spoken message.
 */

import { describe, it, expect } from "vitest";
import type { Concept, ExpressionOption } from "@swara/shared";
import {
  canSpeak,
  flowReducer,
  initialFlowContext,
  persistableSnapshot,
  restoreFlowContext,
  type FlowContext,
  type FlowEvent,
} from "./session-flow.ts";

const base = () => initialFlowContext({ language: "en-IN", speaker: "anushka" });
const concept = (id: string): Concept => ({ id, emoji: "🔵", label: id });

function run(ctx: FlowContext, events: FlowEvent[]): FlowContext {
  return events.reduce(flowReducer, ctx);
}

const threeOptions: ExpressionOption[] = [
  { emotion: "Neutral / calm", text: "My leg hurts." },
  { emotion: "Frustrated", text: "Honestly, my leg hurts." },
  { emotion: "In pain", text: "Leg pain." },
];

const emotionsReady: FlowEvent = {
  type: "EMOTIONS_READY",
  options: threeOptions,
  interpretationText: "My leg hurts.",
  interpretationsShown: [{ text: "My leg hurts.", confidence: 0.9 }],
};

describe("canSpeak — the gate", () => {
  it("is false in `selecting` and `spoken`, even with staged text", () => {
    for (const state of ["selecting", "spoken"] as FlowContext["state"][]) {
      expect(canSpeak({ ...base(), state, stagedText: "anything" })).toBe(false);
    }
  });

  it("is true once staged in `previewing` / `speaking`, false without staged text", () => {
    expect(canSpeak({ ...base(), state: "previewing", stagedText: "My leg hurts." })).toBe(true);
    expect(canSpeak({ ...base(), state: "speaking", stagedText: "My leg hurts." })).toBe(true);
    expect(canSpeak({ ...base(), state: "previewing", stagedText: undefined })).toBe(false);
    expect(canSpeak({ ...base(), state: "previewing", stagedText: "" })).toBe(false);
  });

  it("is true for a pinned instant phrase straight from selection", () => {
    expect(
      canSpeak({ ...base(), tier: "instant", state: "selecting", stagedText: "I need help now." }),
    ).toBe(true);
    expect(
      canSpeak({ ...base(), tier: "instant", state: "selecting", stagedText: undefined }),
    ).toBe(false);
  });
});

describe("the 2-action path", () => {
  it("SUBMIT stays in `selecting` (App runs the silent calls)", () => {
    const ctx = run(base(), [
      { type: "TOGGLE_CONCEPT", concept: concept("leg") },
      { type: "TOGGLE_CONCEPT", concept: concept("pain") },
      { type: "SUBMIT" },
    ]);
    expect(ctx.state).toBe("selecting");
  });

  it("SUBMIT with a pinned instant phrase jumps straight to `previewing`", () => {
    const ctx = run(base(), [
      { type: "TOGGLE_CONCEPT", concept: concept("help") },
      { type: "SET_TIER", tier: "instant", pinnedText: "I need help now." },
      { type: "SUBMIT" },
    ]);
    expect(ctx.state).toBe("previewing");
    expect(ctx.stagedText).toBe("I need help now.");
  });

  it("EMOTIONS_READY stays in `selecting`, stashes the options, stages nothing", () => {
    const ctx = flowReducer({ ...base() }, emotionsReady);
    expect(ctx.state).toBe("selecting");
    expect(ctx.emotionOptions).toHaveLength(3);
    expect(ctx.interpretationText).toBe("My leg hurts.");
    expect(ctx.stagedText).toBeUndefined();
    expect(canSpeak(ctx)).toBe(false);
  });

  it("CHOOSE_EMOTION -> `previewing`, staging the option's exact sentence", () => {
    let ctx = flowReducer({ ...base() }, emotionsReady);
    ctx = flowReducer(ctx, { type: "CHOOSE_EMOTION", option: threeOptions[1]! });
    expect(ctx.state).toBe("previewing");
    expect(ctx.chosenEmotion).toBe("Frustrated");
    expect(ctx.stagedText).toBe("Honestly, my leg hurts.");
    expect(canSpeak(ctx)).toBe(true);
  });

  it("PREVIEW_DONE moves `previewing` -> `speaking`; is a no-op elsewhere", () => {
    const previewing = flowReducer(
      flowReducer({ ...base() }, emotionsReady),
      { type: "CHOOSE_EMOTION", option: threeOptions[0]! },
    );
    expect(flowReducer(previewing, { type: "PREVIEW_DONE" }).state).toBe("speaking");
    expect(flowReducer({ ...base() }, { type: "PREVIEW_DONE" }).state).toBe("selecting");
  });
});

describe("no automatic promotion to instant", () => {
  it("a full 2-action run never yields tier 'instant'", () => {
    const ctx = run(base(), [
      { type: "TOGGLE_CONCEPT", concept: concept("leg") },
      { type: "TOGGLE_CONCEPT", concept: concept("pain") },
      { type: "SUBMIT" },
      emotionsReady,
      { type: "CHOOSE_EMOTION", option: threeOptions[1]! },
      { type: "PREVIEW_DONE" },
      { type: "SPEECH_DONE" },
    ]);
    expect(ctx.tier).toBe("full");
    expect(ctx.state).toBe("spoken");
  });

  it("only an explicit SET_TIER pin sets instant", () => {
    const pinned = flowReducer(base(), {
      type: "SET_TIER",
      tier: "instant",
      pinnedText: "I need help now.",
    });
    expect(pinned.tier).toBe("instant");
    expect(pinned.stagedText).toBe("I need help now.");
  });
});

describe("stale suggestions never survive a change", () => {
  it("TOGGLE_CONCEPT resets a stale elevated tier and clears staged text", () => {
    const ctx = { ...base(), tier: "instant" as const, stagedText: "old pinned phrase" };
    const next = flowReducer(ctx, { type: "TOGGLE_CONCEPT", concept: concept("water") });
    expect(next.tier).toBe("full");
    expect(next.stagedText).toBeUndefined();
    expect(next.emotionOptions).toBeUndefined();
    expect(next.state).toBe("selecting");
  });

  it("SET_LANGUAGE (to a new language) wipes the emotion options", () => {
    const ready = flowReducer({ ...base() }, emotionsReady);
    const next = flowReducer(ready, { type: "SET_LANGUAGE", language: "hi-IN" });
    expect(next.emotionOptions).toBeUndefined();
    expect(next.interpretationText).toBeUndefined();
    expect(next.state).toBe("selecting");
  });
});

describe("SPEECH_CANCELLED — interruptible flash / playback (F-07)", () => {
  it("from `previewing` or `speaking`, lands in `spoken` flagged as cut short", () => {
    for (const state of ["previewing", "speaking"] as FlowContext["state"][]) {
      const next = flowReducer(
        { ...base(), state, stagedText: "My leg hurts." },
        { type: "SPEECH_CANCELLED" },
      );
      expect(next.state).toBe("spoken");
      expect(next.wasCancelled).toBe(true);
    }
  });

  it("is a no-op from any other state", () => {
    for (const state of ["selecting", "spoken"] as FlowContext["state"][]) {
      const next = flowReducer({ ...base(), state }, { type: "SPEECH_CANCELLED" });
      expect(next.state).toBe(state);
      expect(next.wasCancelled).toBe(false);
    }
  });

  it("SPEECH_DONE clears a prior cancelled flag", () => {
    const ctx = { ...base(), state: "speaking" as const, wasCancelled: true };
    expect(flowReducer(ctx, { type: "SPEECH_DONE" }).wasCancelled).toBe(false);
  });
});

describe("session persistence (F-08)", () => {
  it("persistableSnapshot captures only the composable slice", () => {
    const ctx = run(base(), [
      { type: "TOGGLE_CONCEPT", concept: concept("leg") },
      { type: "SET_SPEAKER", speaker: "anand" },
    ]);
    const snap = persistableSnapshot(ctx);
    expect(snap).toMatchObject({
      language: "en-IN",
      speaker: "anand",
      selectedConcepts: [concept("leg")],
    });
    expect(typeof snap.savedAt).toBe("string");
    expect(snap).not.toHaveProperty("state");
  });

  it("restoreFlowContext / HYDRATE always re-enter at `selecting`, never a speakable state", () => {
    const snapshot = {
      language: "hi-IN",
      speaker: "priya",
      selectedConcepts: [concept("leg"), concept("pain")],
      stagedText: "My leg hurts.", // present in the snapshot…
      savedAt: "2026-09-07T00:00:00.000Z",
    };
    const restored = restoreFlowContext(snapshot);
    expect(restored.state).toBe("selecting");
    expect(restored.selectedConcepts).toHaveLength(2);
    expect(restored.language).toBe("hi-IN");
    // …but staged text is NOT restored — nothing rides straight into speech.
    expect(restored.stagedText).toBeUndefined();
    expect(canSpeak(restored)).toBe(false);

    const viaReducer = flowReducer(base(), { type: "HYDRATE", snapshot });
    expect(viaReducer.state).toBe("selecting");
    expect(viaReducer.selectedConcepts).toHaveLength(2);
  });
});
