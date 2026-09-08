/**
 * Adversarial fidelity corpus (Features.md F-03)
 * =============================================
 *
 * The suite had zero tests for the one thing the product promises: that a
 * *drifted* model output is refused. This file is that test. It runs a fixture
 * corpus of `(concepts, confirmedIntent, candidate, expected)` cases drawn from
 * the real failure categories — invented severity / timeframe / frequency /
 * quantity / cause / request, dropped negation, flipped subject, added body part,
 * dropped concept — plus meaning-preserving rewordings that must be ACCEPTED.
 *
 * Case #1 is the worked `[doctor, headache, worse]` example from
 * SWARA_KNOWLEDGE.md §7 verbatim.
 *
 * `checkFidelity` must reject the drift cases at ≥95% (F-01 "Done when").
 */

import { describe, expect, it } from "vitest";
import type { Concept } from "@swara/shared";
import { checkFidelity, partitionByFidelity } from "./fidelity.ts";
import { interpret } from "../api/interpret/handler.ts";
import { generateExpressions } from "../api/generate-expressions/handler.ts";

const c = (label: string): Concept => ({ id: label, emoji: "🔵", label });
const cs = (...labels: string[]): Concept[] => labels.map(c);

interface Case {
  n: number;
  concepts: Concept[];
  intent: string;
  candidate: string;
  expect: "accept" | "reject";
  why: string;
}

let counter = 0;
const mk = (
  concepts: Concept[],
  intent: string,
  candidate: string,
  expected: "accept" | "reject",
  why: string,
): Case => ({ n: ++counter, concepts, intent, candidate, expect: expected, why });

const CORPUS: Case[] = [
  /* ── #1: the canonical forbidden completion (SWARA_KNOWLEDGE.md §7) ─────── */
  mk(
    cs("doctor", "headache", "worse"),
    "Doctor, my headache is worse.",
    "Doctor, I've had severe headaches for three weeks and need stronger medication.",
    "reject",
    "invented severity + timeframe + request, all at once",
  ),

  /* ── meaning-preserving rewordings — MUST be accepted ──────────────────── */
  mk(cs("doctor", "headache", "worse"), "Doctor, my headache is worse.", "Doctor, my headache is worse.", "accept", "identical"),
  mk(cs("doctor", "headache", "worse"), "Doctor, my headache is worse.", "Doctor — my headache has been getting worse.", "accept", "reworded, same content"),
  mk(cs("leg", "pain", "worse"), "My leg pain is worse.", "The pain in my leg is worse.", "accept", "reordered"),
  mk(cs("help", "now"), "I need help now.", "I need help now.", "accept", "identical, request present in intent"),
  mk(cs("help", "now"), "I need help now.", "Help me now, please.", "accept", "politeness added, meaning kept"),
  mk(cs("water", "want"), "I want water.", "I want some water.", "accept", "benign filler 'some'"),
  mk(cs("nurse", "water", "want"), "Nurse, I want water.", "Nurse, I would like water.", "accept", "'would like' ≈ want, want concept present"),
  mk(cs("tired"), "I am tired.", "I'm tired.", "accept", "contraction only"),
  mk(cs("cold"), "I feel cold.", "I am cold.", "accept", "predicate swap"),
  mk(cs("doctor", "leg", "pain"), "Doctor, my leg hurts.", "Doctor, I have pain in my leg.", "accept", "reworded"),
  mk(cs("stomach", "pain"), "My stomach hurts.", "My stomach is hurting.", "accept", "inflection"),
  mk(cs("help", "now"), "help now", "I need help now.", "accept", "'I need' is faithful when a request concept (help) is selected"),
  mk(cs("nurse", "help"), "I need help from the nurse.", "Nurse, I need help.", "accept", "request phrasing kept; 'help' concept present"),

  /* ── invented severity ────────────────────────────────────────────────── */
  mk(cs("doctor", "headache", "worse"), "Doctor, my headache is worse.", "Doctor, my headache is severe.", "reject", "severity + dropped 'worse'"),
  mk(cs("leg", "pain"), "My leg hurts.", "My leg is in excruciating pain.", "reject", "'excruciating'"),
  mk(cs("back", "pain"), "My back hurts.", "I have unbearable back pain.", "reject", "'unbearable'"),
  mk(cs("head"), "My head hurts.", "I have a terrible headache.", "reject", "'terrible'"),
  mk(cs("stomach", "pain"), "My stomach hurts.", "My stomach pain is only mild.", "reject", "'mild' is still invented intensity"),
  mk(cs("leg", "pain"), "My leg hurts.", "My leg hurts a little.", "reject", "'a little' intensity phrase"),

  /* ── invented duration / timeframe ────────────────────────────────────── */
  mk(cs("doctor", "headache", "worse"), "Doctor, my headache is worse.", "Doctor, my headache has been worse for three weeks.", "reject", "'for three weeks'"),
  mk(cs("leg", "pain"), "My leg hurts.", "My leg has hurt since yesterday.", "reject", "'yesterday'"),
  mk(cs("tired"), "I am tired.", "I have been tired all day.", "reject", "'all day'"),
  mk(cs("cough"), "I have a cough.", "I have had a cough for two weeks.", "reject", "'for two weeks'"),
  mk(cs("fever"), "I have a fever.", "I have had a fever since this morning.", "reject", "'this morning'"),
  mk(cs("pain", "worse"), "The pain is worse.", "The pain got worse last night.", "reject", "'last night'"),

  /* ── invented frequency ───────────────────────────────────────────────── */
  mk(cs("head", "pain"), "My head hurts.", "My head hurts constantly.", "reject", "'constantly'"),
  mk(cs("leg", "pain"), "My leg hurts.", "My leg keeps hurting.", "reject", "'keeps hurting'"),
  mk(cs("dizzy"), "I feel dizzy.", "I feel dizzy every morning.", "reject", "'every morning'"),
  mk(cs("cough"), "I have a cough.", "I often have a cough.", "reject", "'often'"),
  mk(cs("pain"), "I have pain.", "The pain comes and goes.", "reject", "'comes and goes'"),

  /* ── invented quantity ────────────────────────────────────────────────── */
  mk(cs("pill", "want"), "I want my pills.", "I want two pills.", "reject", "'two pills'"),
  mk(cs("water", "want"), "I want water.", "I want three glasses of water.", "reject", "'three glasses' — added detail + quantity"),
  mk(cs("medicine", "want"), "I need my medicine.", "I need 2 doses of medicine.", "reject", "digit quantity"),

  /* ── invented cause ──────────────────────────────────────────────────── */
  mk(cs("head", "pain"), "My head hurts.", "My head hurts because I did not sleep.", "reject", "'because' + added clause + negation"),
  mk(cs("stomach", "pain"), "My stomach hurts.", "My stomach hurts due to something I ate.", "reject", "'due to'"),
  mk(cs("tired"), "I am tired.", "I am tired from working late.", "reject", "'from working' cause + added detail"),

  /* ── invented request / demand ───────────────────────────────────────── */
  mk(cs("doctor", "headache", "worse"), "Doctor, my headache is worse.", "Doctor, I need something stronger for my headache.", "reject", "request + dropped 'worse'"),
  mk(cs("leg", "pain"), "My leg hurts.", "Can you give me painkillers for my leg?", "reject", "'can you' + 'give me' + added 'painkillers'"),
  mk(cs("water"), "I have no water.", "Please bring me some water.", "reject", "request + dropped negation"),

  /* ── dropped negation ────────────────────────────────────────────────── */
  mk(cs("breathe"), "I cannot breathe well.", "I can breathe well.", "reject", "negation dropped"),
  mk(cs("pain", "better"), "The pain is not better.", "The pain is better.", "reject", "negation dropped"),

  /* ── added negation ──────────────────────────────────────────────────── */
  mk(cs("hungry"), "I am hungry.", "I am not hungry.", "reject", "negation added"),

  /* ── flipped subject ─────────────────────────────────────────────────── */
  mk(cs("tired", "you"), "I am tired.", "Are you tired?", "reject", "statement → question about you"),
  mk(cs("help"), "I need help.", "Do you need help?", "reject", "statement → question about you"),
  mk(cs("scared"), "I am scared.", "Are you scared?", "reject", "statement → question about you"),

  /* ── added body part / detail noun ──────────────────────────────────── */
  mk(cs("doctor", "pain", "worse"), "Doctor, my pain is worse.", "Doctor, my chest pain is worse.", "reject", "'chest' invented"),
  mk(cs("head", "pain"), "My head hurts.", "My head and neck hurt.", "reject", "'neck' invented"),
  mk(cs("medicine", "want"), "I want my medicine.", "I want my heart medicine.", "reject", "'heart' invented"),
  mk(cs("nurse", "help"), "Nurse, I need help.", "Nurse, I need help getting to the bathroom.", "reject", "'bathroom' invented"),

  /* ── dropped concept (anchor vanished) ──────────────────────────────── */
  mk(cs("doctor", "leg", "pain", "worse"), "Doctor, the pain in my leg is worse.", "Doctor, I am not feeling well.", "reject", "leg + pain + worse all dropped"),
  mk(cs("water", "want"), "I want water.", "I want to rest.", "reject", "'water' dropped, 'rest' invented"),
  mk(cs("head", "pain", "worse"), "My headache is worse.", "My headache is back.", "reject", "'worse' dropped, 'back' invented"),
];

describe("fidelity corpus (F-03)", () => {
  for (const tc of CORPUS) {
    it(`#${tc.n} [${tc.expect}] ${tc.why}`, () => {
      const result = checkFidelity(tc.candidate, tc.intent, tc.concepts);
      if (tc.expect === "accept") {
        expect(result.ok, `expected ACCEPT but got: ${JSON.stringify(result.violations)}`).toBe(true);
      } else {
        expect(result.ok, `expected REJECT but it passed`).toBe(false);
      }
    });
  }

  it("rejects drift cases at ≥95%", () => {
    const drift = CORPUS.filter((tc) => tc.expect === "reject");
    const caught = drift.filter((tc) => !checkFidelity(tc.candidate, tc.intent, tc.concepts).ok);
    const rate = caught.length / drift.length;
    // eslint-disable-next-line no-console
    if (rate < 1) {
      console.log(
        "missed:",
        drift.filter((tc) => checkFidelity(tc.candidate, tc.intent, tc.concepts).ok).map((tc) => tc.n),
      );
    }
    expect(rate).toBeGreaterThanOrEqual(0.95);
  });

  it("does not over-reject meaning-preserving rewordings", () => {
    const keep = CORPUS.filter((tc) => tc.expect === "accept");
    const passed = keep.filter((tc) => checkFidelity(tc.candidate, tc.intent, tc.concepts).ok);
    expect(passed.length / keep.length).toBeGreaterThanOrEqual(0.9);
  });
});

describe("partitionByFidelity", () => {
  it("splits accepted from rejected, preserving order and recording reasons", () => {
    const concepts = cs("leg", "pain");
    const intent = "My leg hurts.";
    const { accepted, rejected } = partitionByFidelity(
      [
        { emotion: "a", text: "My leg hurts." },
        { emotion: "b", text: "My leg is in excruciating pain." },
        { emotion: "c", text: "Doctor, my leg hurts." },
      ],
      intent,
      concepts,
    );
    expect(accepted.map((a) => a.emotion)).toEqual(["a", "c"]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toContain("severity");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * End-to-end: the handlers, not just the predicate (F-03)
 * ──────────────────────────────────────────────────────────────────────────── */

describe("handlers apply the gate end to end (mock path)", () => {
  it("interpret() returns a labelled fallback result when no LLM is configured", async () => {
    const res = await interpret({ concepts: cs("doctor", "leg", "pain", "worse") });
    expect(res.interpretations.length).toBeGreaterThanOrEqual(1);
    expect(res.source).toBe("fallback");
  });

  it("generateExpressions() labels its source and still returns exactly 3 options", async () => {
    const res = await generateExpressions({
      confirmedIntent: "My leg hurts.",
      concepts: cs("leg", "pain"),
    });
    expect(res.options).toHaveLength(3);
    expect(res.source).toBe("fallback");
    for (const opt of res.options) {
      expect(opt.emotion.trim().length).toBeGreaterThan(0);
    }
  });
});
