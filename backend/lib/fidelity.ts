/**
 * Meaning-preservation gate (Features.md F-01)
 * ===========================================
 *
 * The one thing SWARA promises: every phrasing it offers carries the user's
 * *exact* confirmed meaning — nothing invented, nothing dropped
 * (SWARA_KNOWLEDGE.md §7, §8). The old `isFidelityCompliant` was a ten-string
 * blocklist that never even looked at the confirmed intent. This module is the
 * real check, in deterministic layers, cheapest first:
 *
 *   1. Anchor check   — every content-bearing token of the confirmed intent, and
 *                       every concept label, must survive into the candidate
 *                       (synonym/inflection tolerant). A candidate that drops an
 *                       anchor dropped meaning; one that adds a content token
 *                       present in neither the intent nor the concepts added
 *                       meaning.
 *   2. Claim diff     — categories the fidelity constraint names (severity,
 *                       duration, frequency, quantity, cause, request, negation,
 *                       subject person) detected with real lexicons; any category
 *                       present in the candidate but absent from the intent is a
 *                       rejection.
 *   3. Model verifier — optional, behind a flag, in llm-client-backed callers.
 *                       Not implemented here; `checkFidelity` is pure and sync.
 *
 * Pure, no I/O. Shared by /interpret and /generate-expressions so the two paths
 * cannot drift (Features.md F-01 "share isFidelityCompliant's replacement").
 */

import type { Concept, RejectedCandidate } from "@swara/shared";

/* ────────────────────────────────────────────────────────────────────────────
 * Result shape
 * ──────────────────────────────────────────────────────────────────────────── */

export type FidelityViolationCategory =
  | "empty"
  | "dropped-anchor"
  | "added-detail"
  | "invented-severity"
  | "invented-duration"
  | "invented-frequency"
  | "invented-quantity"
  | "invented-cause"
  | "invented-request"
  | "dropped-negation"
  | "added-negation"
  | "flipped-subject";

export interface FidelityViolation {
  category: FidelityViolationCategory;
  detail: string;
}

export interface FidelityResult {
  ok: boolean;
  violations: FidelityViolation[];
}

/** One-line reason string for provenance / logs. */
export function fidelityReason(result: FidelityResult): string {
  if (result.ok) return "ok";
  return result.violations.map((v) => `${v.category}: ${v.detail}`).join("; ");
}

/* ────────────────────────────────────────────────────────────────────────────
 * Lexicons
 * ──────────────────────────────────────────────────────────────────────────── */

const STOP_WORDS = new Set([
  "a", "an", "the", "this", "that", "these", "those", "and", "or", "but", "so",
  "to", "of", "in", "on", "at", "by", "for", "with", "as", "is", "am", "are",
  "was", "were", "be", "been", "being", "do", "does", "did", "have", "has",
  "had", "having", "will", "would", "shall", "should", "may", "might", "must",
  "can", "could", "i", "me", "my", "mine", "we", "us", "our", "ours", "you",
  "your", "yours", "he", "she", "it", "its", "they", "them", "their", "theirs",
  "his", "her", "hers", "him", "there", "here", "then", "than", "too", "very",
  "just", "about", "up", "down", "out", "off", "over", "into", "if", "when",
  "while", "because", "s", "re", "m", "ve", "ll", "d", "t",
  // contraction residue after clitic stripping / auxiliary negatives — negation
  // is detected separately on the raw text, so these carry no content here.
  "don", "doesn", "didn", "won", "wouldn", "isn", "aren", "wasn", "weren",
  "haven", "hasn", "hadn", "shouldn", "couldn", "mustn", "needn", "ain",
  "cant", "wont", "gonna", "wanna", "im",
]);

/**
 * Determiners / hedges that add no propositional content — "some water" says no
 * more than "water". Skipped in the added-detail check like framing particles.
 */
const BENIGN_FILLER = new Set([
  "some", "any", "kind", "sort", "really", "quite", "rather", "pretty",
  "somewhat", "currently", "still",
]);

/**
 * Discomfort predicates — "it hurts", "aching", "sore". Generic ways of saying
 * *something is wrong* without adding any specific detail. Allowed to appear in a
 * candidate that did not literally contain them; still participate in synonym
 * clustering so they can satisfy a "pain" anchor.
 */
const DISCOMFORT_PREDICATES = new Set([
  "hurt", "hurts", "hurting", "ache", "aches", "aching", "sore", "pain",
  "pains", "painful", "feel", "feels", "feeling", "felt", "get", "gets",
  "getting", "got", "go", "goes", "going", "gone", "want", "wants", "wanting",
  "need", "needs", "needing",
]);

/**
 * Vocatives and politeness particles. Adding "Doctor," or "please" changes
 * register, not propositional content — the fidelity constraint's own worked
 * example keeps "Doctor," in the acceptable rewrite.
 */
const FRAMING_ALLOWLIST = new Set([
  "doctor", "dr", "nurse", "sir", "madam", "maam", "ma'am", "please", "excuse",
  "sorry", "pardon", "thanks", "thank", "kindly", "hey", "hello", "hi", "hiya",
  "well", "um", "uh", "oh", "okay", "ok", "right", "actually", "honestly",
  "look", "listen", "mate", "friend", "everyone", "somebody", "someone",
]);

/** Severity / intensity markers. `worse` / `better` are omitted — they are legit comparison concepts. */
const SEVERITY = [
  "severe", "severely", "severity", "unbearable", "unbearably", "excruciating",
  "excruciatingly", "agonising", "agonizing", "agony", "extreme", "extremely",
  "intense", "intensely", "terrible", "terribly", "awful", "awfully", "horrible",
  "horribly", "mild", "mildly", "slight", "slightly", "minor", "serious",
  "seriously", "critical", "critically", "acute", "chronic", "worst", "killing",
  "crippling", "debilitating", "faint", "faintly", "unbearability",
];

/** Multi-word intensity phrases the constraint names explicitly ("a little", "a bit"). */
const SEVERITY_PATTERNS: RegExp[] = [
  /\ba little\b/, /\ba bit\b/, /\ba lot of pain\b/, /\bnot too bad\b/,
  /\bhardly\b/, /\bbarely\b/,
];

const NEGATIONS = [
  "no", "not", "n't", "never", "none", "nothing", "nobody", "nowhere",
  "neither", "nor", "without", "cannot", "can't", "don't", "doesn't", "didn't",
  "won't", "wouldn't", "isn't", "aren't", "wasn't", "weren't", "haven't",
  "hasn't", "hadn't", "shouldn't", "couldn't", "can not",
];

/** Frequency markers. Regex-anchored so multi-word phrases are caught. */
const FREQUENCY_PATTERNS: RegExp[] = [
  /\boften\b/, /\bfrequently\b/, /\bconstantly\b/, /\balways\b/, /\bsometimes\b/,
  /\boccasionally\b/, /\brarely\b/, /\brepeatedly\b/, /\busually\b/,
  /\bevery (day|night|morning|hour|time)\b/, /\beach (day|night|morning)\b/,
  /\bdaily\b/, /\bhourly\b/, /\bnightly\b/, /\ball the time\b/, /\bon and off\b/,
  /\bnow and then\b/, /\bintermittently\b/, /\bmost of the time\b/,
  /\bagain and again\b/, /\bkeeps? (on )?\w+ing\b/, /\bcomes and goes\b/,
];

/** Duration / timeframe markers. */
const DURATION_PATTERNS: RegExp[] = [
  /\b(for|since|over|within|after|in) (the )?(a |an )?(past |last |next )?(\w+ )?(second|minute|hour|day|week|month|year)s?\b/,
  /\b(yesterday|today|tonight|tomorrow)\b/,
  /\b(this|last|next) (morning|afternoon|evening|night|week|month|year)\b/,
  /\ball (day|night|week|morning)\b/,
  /\b(a )?(long|short|little|brief) (time|while)\b/,
  /\bfor (a )?(while|ages|now|days|weeks|months|years|hours)\b/,
  /\bever since\b/, /\bfor \d+\b/, /\b\d+ (second|minute|hour|day|week|month|year)s?\b/,
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|several|many|couple|few) (second|minute|hour|day|week|month|year)s?\b/,
  /\brecently\b/, /\blately\b/, /\bearlier\b/, /\bmoments? ago\b/, /\bjust now\b/,
];

/** Quantity / measurement markers. */
const QUANTITY_PATTERNS: RegExp[] = [
  /\b\d+(\.\d+)?\b/, /\btwice\b/, /\bthrice\b/, /\bdouble\b/, /\btriple\b/,
  /\ba lot\b/, /\blots\b/, /\bplenty\b/, /\bseveral\b/, /\bmultiple\b/,
  /\bnumerous\b/, /\ba (couple|few|bit|little)\b/, /\bhalf\b/, /\bquarter\b/,
  /\b(one|two|three|four|five|six|seven|eight|nine|ten) (times?|of them|pills?|tablets?|doses?)\b/,
];

/** Cause / explanation markers. */
const CAUSE_PATTERNS: RegExp[] = [
  /\bbecause\b/, /\bdue to\b/, /\bcaused by\b/, /\bas a result\b/,
  /\bon account of\b/, /\bthanks to\b/, /\bowing to\b/, /\bthat's why\b/,
  /\btherefore\b/, /\bconsequently\b/, /\bso that\b/, /\bfrom (eating|drinking|the|a)\b/,
  /\bafter (eating|drinking|taking|the)\b/, /\bit'?s from\b/,
];

/** Request / demand markers (a confirmed intent that did not ask for anything). */
const REQUEST_PATTERNS: RegExp[] = [
  /\bcan you\b/, /\bcould you\b/, /\bwould you\b/, /\bwill you\b/,
  /\bplease (give|bring|get|pass|hand|fetch|prescribe|help)\b/,
  /\bgive me\b/, /\bbring me\b/, /\bget me\b/, /\bhand me\b/, /\bpass me\b/,
  /\bi need\b/, /\bi want\b/, /\bi require\b/, /\bi'd like\b/, /\bi would like\b/,
  /\bi'?m asking\b/, /\bmay i have\b/, /\blet me have\b/, /\bhelp me\b/,
  /\bprescribe\b/, /\bstronger (medication|painkillers?|meds?|drugs?)\b/,
  /\bsomething (stronger|for the)\b/,
];

/* ────────────────────────────────────────────────────────────────────────────
 * Synonym clusters (anchor tolerance)
 * ──────────────────────────────────────────────────────────────────────────── */

const SYNONYM_CLUSTERS: string[][] = [
  ["pain", "hurt", "ache", "sore", "painful", "hurting", "aching"],
  ["worse", "worsening", "worsened", "deteriorating", "declining"],
  ["better", "improving", "improved", "improvement", "easing"],
  ["help", "assistance", "aid", "assist"],
  ["doctor", "dr", "physician", "clinician"],
  ["tired", "exhausted", "fatigued", "sleepy", "weary", "fatigue"],
  ["cold", "chilly", "freezing", "shivering"],
  ["hot", "warm", "feverish", "burning"],
  ["head", "headache"],
  ["stomach", "belly", "tummy", "abdomen", "abdominal"],
  ["medicine", "medication", "meds", "drug", "drugs", "pill", "pills", "tablet", "tablets"],
  ["food", "eat", "eating", "hungry", "meal"],
  ["water", "drink", "thirsty"],
  ["toilet", "bathroom", "restroom", "washroom", "loo"],
  ["want", "need", "wish", "like"],
  ["breathe", "breathing", "breath", "breathless"],
  ["dizzy", "dizziness", "lightheaded", "faint"],
  ["nausea", "nauseous", "nauseated", "sick", "queasy"],
  ["scared", "afraid", "frightened", "anxious", "worried"],
  ["now", "immediately", "right away", "urgently"],
];

const CLUSTER_OF = new Map<string, string>();
for (const cluster of SYNONYM_CLUSTERS) {
  const rep = cluster[0]!;
  for (const word of cluster) CLUSTER_OF.set(word, rep);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Tokenisation
 * ──────────────────────────────────────────────────────────────────────────── */

/** Lowercase, strip surrounding punctuation, drop possessive and contraction clitics. */
function normaliseToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "")
    .replace(/n't$/, "")
    .replace(/'(s|m|re|ve|ll|d)$/, "");
}

/** Naive suffix stemmer — enough to match "headaches"→"headache", "hurts"→"hurt". */
function stem(token: string): string {
  let t = token;
  if (t.length > 5 && t.endsWith("ing")) t = t.slice(0, -3);
  else if (t.length > 4 && t.endsWith("ed")) t = t.slice(0, -2);
  else if (t.length > 4 && t.endsWith("es")) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
  return t;
}

/** Canonical form for anchor comparison: synonym-cluster rep, else stem. */
function canonical(token: string): string {
  return CLUSTER_OF.get(token) ?? CLUSTER_OF.get(stem(token)) ?? stem(token);
}

/** Content tokens: normalised, non-empty, non-stop-word. */
export function contentTokens(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normaliseToken)
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t));
}

function canonicalSet(text: string): Set<string> {
  return new Set(contentTokens(text).map(canonical));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Claim detection
 * ──────────────────────────────────────────────────────────────────────────── */

function hasAny(lowerText: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = lowerText.match(p);
    if (m) return m[0];
  }
  return null;
}

function severityHit(tokens: string[], lowerText: string): string | null {
  for (const t of tokens) if (SEVERITY.includes(t) || SEVERITY.includes(stem(t))) return t;
  return hasAny(lowerText, SEVERITY_PATTERNS);
}

/** Detect negation directly on the raw lowercased text (word-boundary safe). */
function negationTokens(lowerText: string): Set<string> {
  const found = new Set<string>();
  if (/\w+n't\b/.test(lowerText)) found.add("n't");
  for (const n of NEGATIONS) {
    if (n === "n't") continue;
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, "i").test(lowerText)) found.add(n);
  }
  return found;
}

/** A first-person declarative that a candidate must not turn into a question about "you". */
function isFirstPersonStatement(lowerText: string): boolean {
  return (/\bi\b|\bi'm\b|\bmy\b|\bme\b|\bwe\b|\bour\b/.test(lowerText)) && !lowerText.trimEnd().endsWith("?");
}

function isSecondPersonQuestion(lowerText: string): boolean {
  const trimmed = lowerText.trimEnd();
  return (
    trimmed.endsWith("?") ||
    /\bare you\b|\bdo you\b|\bhave you\b|\bdid you\b|\bwould you\b|\bcan you\b|\byou are\b/.test(trimmed)
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * The gate
 * ──────────────────────────────────────────────────────────────────────────── */

export interface CheckFidelityOptions {
  /**
   * When true (default), an extra content noun/adjective in the candidate that is
   * absent from both intent and concepts is a rejection ("added-detail"). Set
   * false to only run the claim-diff layer — used by the back-compat
   * `isFidelityCompliant` shim which has no reliable intent to anchor against.
   */
  anchorCheck?: boolean;
  /**
   * Target language code (Features.md F-13). The anchor and claim-diff lexicons
   * are English-only, so for a non-English candidate they would reject
   * everything. When a non-English language is passed, only the language-agnostic
   * checks run (non-empty, and statement→question subject flip via punctuation);
   * meaning preservation otherwise leans on the model verifier + the human
   * Meaning Check. This is a known limitation — see SPEC.md §9.
   */
  language?: string;
}

/** English (or unspecified) ⇒ the full deterministic gate applies. */
export function isEnglishLike(language: string | undefined): boolean {
  return !language || language.toLowerCase().startsWith("en");
}

/**
 * Check whether `candidate` preserves the meaning of `confirmedIntent`, given the
 * originally-selected `concepts`. Deterministic and free.
 */
export function checkFidelity(
  candidate: string,
  confirmedIntent: string,
  concepts: Concept[],
  options: CheckFidelityOptions = {},
): FidelityResult {
  const anchorCheck = options.anchorCheck ?? true;
  const violations: FidelityViolation[] = [];

  const cand = candidate.trim();
  if (cand === "") {
    return { ok: false, violations: [{ category: "empty", detail: "candidate is empty" }] };
  }

  // F-13: the lexicons below are English. For a non-English candidate, run only
  // the language-agnostic checks and let the human Meaning Check + model verifier
  // carry the rest.
  if (!isEnglishLike(options.language)) {
    const flipped =
      isFirstPersonStatement(confirmedIntent.toLowerCase()) &&
      cand.trimEnd().endsWith("?") &&
      !confirmedIntent.trimEnd().endsWith("?");
    return flipped
      ? { ok: false, violations: [{ category: "flipped-subject", detail: "statement rendered as a question" }] }
      : { ok: true, violations: [] };
  }

  const candLower = cand.toLowerCase();
  const intentLower = confirmedIntent.toLowerCase();

  const candTokens = contentTokens(cand);
  const intentTokens = contentTokens(confirmedIntent);
  const conceptLabelTokens = concepts.flatMap((c) => contentTokens(c.label));

  const candCanon = new Set(candTokens.map(canonical));
  const intentCanon = new Set(intentTokens.map(canonical));
  const conceptCanon = new Set(conceptLabelTokens.map(canonical));

  /* ── Layer 1a: dropped anchors ──────────────────────────────────────────── */
  // A message *is* its concept set (SWARA_KNOWLEDGE.md §4): every selected
  // concept's meaning must survive into the candidate. Synonym/inflection
  // tolerance comes from canonical(). Intent prose is NOT used as a hard anchor
  // source — it is full of function words ("some", "would", "like") that are not
  // load-bearing — but it does widen the allow-list for the added-detail check.
  const requiredAnchors = new Set<string>(conceptCanon);
  for (const anchor of requiredAnchors) {
    if (!candCanon.has(anchor)) {
      violations.push({
        category: "dropped-anchor",
        detail: `"${anchor}" from the selected concepts is missing`,
      });
    }
  }

  /* ── Layer 1b: added detail ─────────────────────────────────────────────── */
  if (anchorCheck) {
    for (const tok of candTokens) {
      if (FRAMING_ALLOWLIST.has(tok) || BENIGN_FILLER.has(tok)) continue;
      if (DISCOMFORT_PREDICATES.has(tok) || DISCOMFORT_PREDICATES.has(stem(tok))) continue;
      const canon = canonical(tok);
      if (requiredAnchors.has(canon)) continue;
      if (intentCanon.has(canon) || conceptCanon.has(canon)) continue;
      // Not an anchor, not framing, not a generic predicate, not in the confirmed
      // intent → invented content.
      violations.push({
        category: "added-detail",
        detail: `"${tok}" is not in the confirmed meaning or the concepts`,
      });
    }
  }

  /* ── Layer 2: claim diff (candidate has a claim category the intent lacks) ─ */
  const check = (
    category: FidelityViolationCategory,
    candHit: string | null,
    intentHit: string | null,
  ) => {
    if (candHit && !intentHit) {
      violations.push({ category, detail: `"${candHit.trim()}" not present in the confirmed meaning` });
    }
  };

  check("invented-severity", severityHit(candTokens, candLower), severityHit(intentTokens, intentLower));
  check("invented-duration", hasAny(candLower, DURATION_PATTERNS), hasAny(intentLower, DURATION_PATTERNS));
  check("invented-frequency", hasAny(candLower, FREQUENCY_PATTERNS), hasAny(intentLower, FREQUENCY_PATTERNS));
  check("invented-quantity", hasAny(candLower, QUANTITY_PATTERNS), hasAny(intentLower, QUANTITY_PATTERNS));
  check("invented-cause", hasAny(candLower, CAUSE_PATTERNS), hasAny(intentLower, CAUSE_PATTERNS));

  // Requests: a demand phrase in the candidate is only invented if the intent
  // did not ask for anything AND no request-shaped concept was selected. "help",
  // "want", "need", "please" are themselves requests — "I need help" is a
  // faithful reading of the concept `help`, not invented content.
  const REQUEST_CONCEPTS = ["want", "help", "need", "please", "ask"];
  const conceptHasRequest = REQUEST_CONCEPTS.some(
    (r) => conceptCanon.has(canonical(r)) || conceptCanon.has(r),
  );
  const candReq = hasAny(candLower, REQUEST_PATTERNS);
  const intentReq = hasAny(intentLower, REQUEST_PATTERNS);
  if (candReq && !intentReq && !conceptHasRequest) {
    violations.push({ category: "invented-request", detail: `"${candReq.trim()}" is a request the confirmed meaning does not make` });
  }

  /* ── Layer 2b: negation flips ───────────────────────────────────────────── */
  const candNeg = negationTokens(candLower);
  const intentNeg = negationTokens(intentLower);
  if (intentNeg.size > 0 && candNeg.size === 0) {
    violations.push({ category: "dropped-negation", detail: "the confirmed meaning is negated but the phrasing is not" });
  }
  if (candNeg.size > 0 && intentNeg.size === 0) {
    violations.push({ category: "added-negation", detail: "the phrasing is negated but the confirmed meaning is not" });
  }

  /* ── Layer 2c: subject / person flip ────────────────────────────────────── */
  if (isFirstPersonStatement(intentLower) && isSecondPersonQuestion(candLower)) {
    violations.push({ category: "flipped-subject", detail: "a first-person statement was turned into a question about \"you\"" });
  }

  return { ok: violations.length === 0, violations };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Helpers for the handlers
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Partition model candidates into those that preserve `confirmedIntent` and those
 * the gate rejects (with a reason string). Order is preserved.
 */
export function partitionByFidelity<T extends { text: string }>(
  candidates: T[],
  confirmedIntent: string,
  concepts: Concept[],
  options: CheckFidelityOptions = {},
): { accepted: T[]; rejected: RejectedCandidate[] } {
  const accepted: T[] = [];
  const rejected: RejectedCandidate[] = [];
  for (const c of candidates) {
    const result = checkFidelity(c.text, confirmedIntent, concepts, options);
    if (result.ok) accepted.push(c);
    else rejected.push({ text: c.text, reason: fidelityReason(result) });
  }
  return { accepted, rejected };
}
