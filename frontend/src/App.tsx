import { useEffect, useReducer, useRef, useState } from "react";
import type { Concept, ExpressionOption, ProvenanceMeta } from "@swara/shared";
import "./index.css";
import "./styles/theme.css";
import { AuroraText } from "@/components/ui/aurora-text.tsx";
import { BorderBeam } from "@/components/ui/border-beam.tsx";
import { Particles } from "@/components/ui/particles.tsx";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler.tsx";
import {
  confirmTrustLadder,
  generateExpressions,
  getTrustLadderStatus,
  interpret,
  logProvenance,
  pinToInstant,
  unpinFromInstant,
  synthesizeSpeech,
} from "./api-client.ts";
import { ConceptGrid } from "./components/ConceptGrid.tsx";
import { EmotionPicker } from "./components/EmotionPicker.tsx";
import { PalettePicker } from "./components/PalettePicker.tsx";
import { SettingsPage } from "./components/SettingsPage.tsx";
import { emotionIcon } from "./lib/emotion.ts";
import {
  getPalettes,
  getVoices,
  type LanguageInfo,
  type VoiceInfo,
} from "./api-client.ts";
import { loadSettings, saveSettings, type A11ySettings } from "./lib/settings.ts";
import { useAccessibility } from "./lib/use-accessibility.ts";
import {
  addUserConcept,
  applyTileOrder,
  getTileOrder,
  getUserConcepts,
  recordUsage,
  setTileOrder,
} from "./lib/palette-store.ts";
import { arrayMove } from "@dnd-kit/sortable";
import type { ConceptPalette } from "@swara/shared";
import {
  flowReducer,
  initialFlowContext,
  persistableSnapshot,
  type ExpressionsMeta,
  type PersistedSession,
} from "./state/session-flow.ts";
import {
  clearSession,
  isResumable,
  loadSession,
  saveSession,
} from "./lib/session-persistence.ts";
import type { GenerateExpressionsResponse } from "@swara/shared";

/** Build identifier recorded into provenance meta (F-04). */
const APP_VERSION: string =
  (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "dev";

/** Lift the F-02/F-04 fields off a /generate-expressions response into flow meta. */
function metaFromExpressions(res: GenerateExpressionsResponse): ExpressionsMeta {
  return {
    source: res.source,
    degraded: res.degraded,
    rejectedCandidates: res.rejectedCandidates,
    llmProvider: res.llmProvider,
    llmModel: res.llmModel,
  };
}

/**
 * A minimal offline board so the app is usable before `/api/palettes` responds
 * (or with no backend at all). The real boards come from the server (F-10).
 */
const FALLBACK_PALETTE: ConceptPalette = {
  id: "starter",
  name: "Starter",
  locale: "en-IN",
  source: "bundled",
  categories: ["People", "Body", "Sensations", "Needs"],
  concepts: [
    { id: "doctor", emoji: "👨‍⚕️", label: "doctor", category: "People" },
    { id: "nurse", emoji: "👩‍⚕️", label: "nurse", category: "People" },
    { id: "you", emoji: "👉", label: "you", category: "People" },
    { id: "leg", emoji: "🦵", label: "leg", category: "Body" },
    { id: "head", emoji: "🤕", label: "head", category: "Body" },
    { id: "pain", emoji: "😣", label: "pain", category: "Sensations" },
    { id: "worse", emoji: "📈", label: "worse", category: "Sensations" },
    { id: "better", emoji: "📉", label: "better", category: "Sensations" },
    { id: "tired", emoji: "😴", label: "tired", category: "Sensations" },
    { id: "cold", emoji: "🥶", label: "cold", category: "Sensations" },
    { id: "help", emoji: "🆘", label: "help", category: "Needs" },
    { id: "water", emoji: "💧", label: "water", category: "Needs" },
    { id: "want", emoji: "🙏", label: "want", category: "Needs" },
    { id: "now", emoji: "⏱️", label: "now", category: "Needs" },
  ],
};

/** Locale-aware display label for a concept (F-13). */
function labelFor(concept: Concept, locale: string): Concept {
  const localised = concept.labels?.[locale];
  return localised ? { ...concept, label: localised } : concept;
}

/** Merge every board's tiles into one list, first occurrence of an id wins. */
function dedupeById(concepts: Concept[]): Concept[] {
  const seen = new Set<string>();
  const out: Concept[] = [];
  for (const c of concepts) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      out.push(c);
    }
  }
  return out;
}

export function App(): JSX.Element {
  const [ctx, dispatch] = useReducer(
    flowReducer,
    // speaker must match SARVAM_MODEL in swara/.env: "priya" is a bulbul:v3 voice.
    // (bulbul:v2 uses "anushka") — see swara/backend/lib/voices.ts.
    { language: "en-IN", speaker: "priya" },
    initialFlowContext,
  );

  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  /** F-08: an interrupted composition found in localStorage, offered back on load. */
  const [resumable, setResumable] = useState<PersistedSession | null>(null);

  /** F-13 / F-14: languages + voices valid for the configured Bulbul model. */
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [languages, setLanguages] = useState<LanguageInfo[]>([]);

  /** F-15: accessibility settings (persisted) + the switch-scanning / dwell engine. */
  const [settings, setSettings] = useState<A11ySettings>(() => loadSettings());
  const { liveMessage, announce } = useAccessibility(settings);

  /** Light / dark theme. `<html>` carries `.dark` by default (set pre-paint in
   *  index.html); this owns persistence and the AnimatedThemeToggler is driven
   *  from it (controlled). */
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      return localStorage.getItem("theme") === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* private mode / storage disabled — the in-memory state still applies */
    }
  }, [theme]);

  /** OS "reduce motion" preference — mirrors the CSS media query so the
   *  JS-driven MagicUI accents (BorderBeam / Particles) can be switched off too. */
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setPrefersReducedMotion(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  /** Whether the premium glass decoration (aurora backdrop, particles, beams)
   *  should animate. Off for reduced-motion and high-contrast users. */
  const decorEnabled =
    !settings.reduceMotion && !settings.highContrast && !prefersReducedMotion;

  /** Which top-level view is showing. The Settings page is a sibling of the loop,
   *  not a step in it — App never unmounts, so all state below is preserved. */
  const [view, setView] = useState<"home" | "settings">("home");

  /** F-10: the concept tiles as ONE unified set. `getPalettes()` may still return
   *  several named boards; their tiles are merged (deduped by id) into a single
   *  pool with no board picker. User-created tiles are appended. */
  const [serverPalettes, setServerPalettes] = useState<ConceptPalette[]>([FALLBACK_PALETTE]);
  const [userConcepts, setUserConcepts] = useState<Concept[]>(() => getUserConcepts());
  const [conceptSearch, setConceptSearch] = useState("");
  const [adding, setAdding] = useState(false);
  /** The user's drag-rearranged tile order (concept ids), persisted per device. */
  const [tileOrder, setTileOrderState] = useState<string[]>(() => getTileOrder());

  const unifiedTiles = dedupeById(serverPalettes.flatMap((p) => p.concepts));
  const boardConcepts = unifiedTiles.map((c) => labelFor(c, ctx.language));
  const userTiles = userConcepts.map((c) => labelFor(c, ctx.language));
  const poolConcepts = applyTileOrder([...boardConcepts, ...userTiles], tileOrder);

  const visibleConcepts = poolConcepts.filter((c) => {
    if (!conceptSearch.trim()) return true;
    const q = conceptSearch.trim().toLowerCase();
    return c.label.toLowerCase().includes(q) || c.id.toLowerCase().includes(q);
  });

  function handleAddUserConcept(concept: Concept) {
    setUserConcepts(addUserConcept(concept));
  }

  /**
   * Persist a drag-and-drop rearrange. Reorders only the slots currently on
   * screen (so an active search filter doesn't drag hidden tiles around), then
   * writes back the FULL id order so the arrangement survives reloads and covers
   * every tile view.
   */
  function handleReorderTiles(activeId: string, overId: string) {
    const visIds = visibleConcepts.map((c) => c.id);
    const from = visIds.indexOf(activeId);
    const to = visIds.indexOf(overId);
    if (from === -1 || to === -1) return;
    const nextVis = arrayMove(visIds, from, to);
    const visSet = new Set(visIds);
    let k = 0;
    const nextFull = poolConcepts.map((c) => (visSet.has(c.id) ? nextVis[k++]! : c.id));
    setTileOrderState(nextFull);
    setTileOrder(nextFull);
  }

  function updateSettings(patch: Partial<A11ySettings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }

  /**
   * F-07: hold the live audio element so playback can be stopped, and cache the
   * last synthesised clip + its provenance id so "Say it again" can replay with
   * no new synthesis and no new approval gesture (same already-approved text).
   */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastAudioRef = useRef<{ src: string; text: string; provenanceId?: string } | null>(null);

  function flashNotification(message: string, ms = 4000) {
    setNotification(message);
    window.setTimeout(() => setNotification(null), ms);
  }

  // F-08: on first load, surface any interrupted composition for the user to
  // resume. We do NOT auto-restore — restoring silently past the Meaning Check
  // is exactly what must not happen.
  useEffect(() => {
    const saved = loadSession();
    if (isResumable(saved)) setResumable(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // F-08: persist the composable context on every change. Never includes flow
  // state — a restore always re-enters at `selecting` (see restoreFlowContext).
  useEffect(() => {
    saveSession(persistableSnapshot(ctx));
  }, [ctx.language, ctx.speaker, ctx.selectedConcepts, ctx.stagedText]);

  // F-13 / F-14: load the voice + language catalogue once, and align the current
  // speaker/language with what the configured model actually supports.
  useEffect(() => {
    let active = true;
    getVoices()
      .then((res) => {
        if (!active) return;
        setVoices(res.voices);
        setLanguages(res.languages);
        if (!res.voices.some((v) => v.id === ctx.speaker)) {
          dispatch({ type: "SET_SPEAKER", speaker: res.defaultSpeaker });
        }
        if (!res.languages.some((l) => l.code === ctx.language)) {
          dispatch({ type: "SET_LANGUAGE", language: res.defaultLanguage });
        }
      })
      .catch((err) => console.warn("[voices] catalogue fetch failed:", err));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // F-10: load the concept tiles. Whatever boards the server returns are merged
  // into one unified pool (see `unifiedTiles`); there is no board to "select".
  useEffect(() => {
    let active = true;
    getPalettes()
      .then((res) => {
        if (!active || res.palettes.length === 0) return;
        setServerPalettes(res.palettes);
      })
      .catch((err) => console.warn("[palettes] fetch failed, using fallback tiles:", err));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleResume() {
    if (resumable) dispatch({ type: "HYDRATE", snapshot: resumable });
    setResumable(null);
  }

  function handleDismissResume() {
    setResumable(null);
    clearSession();
  }

  // Check Trust Ladder status whenever selected concepts change
  useEffect(() => {
    if (ctx.selectedConcepts.length === 0) return;

    let active = true;
    getTrustLadderStatus(ctx.selectedConcepts)
      .then((status) => {
        if (!active) return;
        dispatch({
          type: "SET_TIER",
          tier: status.tier,
          pinnedText: status.entry?.pinnedText,
        });
      })
      .catch((err) => {
        console.warn("[TrustLadder] status fetch failed:", err);
      });

    return () => {
      active = false;
    };
  }, [ctx.selectedConcepts]);

  function handleToggleConcept(concept: Concept) {
    dispatch({ type: "TOGGLE_CONCEPT", concept });
  }

  function handleUndoLastConcept() {
    if (ctx.selectedConcepts.length === 0) return;
    const last = ctx.selectedConcepts[ctx.selectedConcepts.length - 1];
    if (last) {
      dispatch({ type: "TOGGLE_CONCEPT", concept: last });
    }
  }

  function handleClearConcepts() {
    dispatch({ type: "RESET" });
  }

  /**
   * User action 1 done: derive the sentence and the 3 emotional tones invisibly.
   * `/interpret` (top reading only — no Meaning Check) then `/generate-expressions`
   * (3 emotion-labelled, fidelity-gated options). The user stays on the concept
   * screen; the emotion tags appear inline when this resolves.
   */
  async function handleSubmit() {
    if (ctx.selectedConcepts.length === 0) return;

    dispatch({ type: "SUBMIT" });

    // Pinned instant phrase: no interpret/generate — the reducer already moved us
    // to `previewing`; the flash + speak effects take it from here.
    if (ctx.tier === "instant" && ctx.stagedText) return;

    setLoading(true);
    try {
      const interpretation = await interpret({
        concepts: ctx.selectedConcepts,
        language: ctx.language,
      });
      const intent = interpretation.interpretations[0]?.text?.trim();
      if (!intent) {
        dispatch({ type: "ERROR", message: "Could not read a meaning from those tiles." });
        return;
      }
      const res = await generateExpressions({
        confirmedIntent: intent,
        concepts: ctx.selectedConcepts,
        language: ctx.language,
      });
      dispatch({
        type: "EMOTIONS_READY",
        options: res.options,
        interpretationText: intent,
        interpretationsShown: interpretation.interpretations,
        meta: metaFromExpressions(res),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not prepare the message.";
      dispatch({ type: "ERROR", message: msg });
    } finally {
      setLoading(false);
    }
  }

  /** User action 2 (final): pick a tone. The reducer moves to `previewing`; the
   *  flash + speak effects do the rest — there is no further confirmation. */
  function handleChooseEmotion(option: ExpressionOption) {
    dispatch({ type: "CHOOSE_EMOTION", option });
  }

  /**
   * Build the provenance meta for a spoken message. F-04: the audit trail must be
   * enough to answer "why did SWARA say that?" without server logs — so it records
   * where the phrasing came from, which candidates the (invisible) fidelity gate
   * rejected, and which emotional tone the user picked.
   */
  function buildProvenanceMeta(extra: Partial<ProvenanceMeta> = {}): ProvenanceMeta {
    const em = ctx.expressionsMeta;
    return {
      emotion: ctx.chosenEmotion,
      language: ctx.language,
      speaker: ctx.speaker,
      source: em?.source,
      llmProvider: em?.llmProvider,
      llmModel: em?.llmModel,
      rejectedCandidates: (em?.rejectedCandidates ?? []).slice(0, 20),
      appVersion: APP_VERSION,
      ...extra,
    };
  }

  /**
   * Synthesise + play the staged sentence. Called from a `useEffect` once the
   * reducer has entered `speaking` (i.e. after the `previewing` flash, or the
   * pinned-instant shortcut). No approval re-check here — the reducer's
   * transition into `speaking` IS the gate. Provenance is written for every
   * spoken message (F-04), audit trail intact despite the removed checkpoints.
   */
  async function speakStaged() {
    const textToSpeak = ctx.stagedText;
    if (!textToSpeak || !textToSpeak.trim()) {
      setSpeaking(false);
      dispatch({ type: "SPEECH_DONE" });
      return;
    }

    setSpeaking(true);
    const ttsStarted = performance.now();
    try {
      const ttsRes = await synthesizeSpeech({
        text: textToSpeak,
        language: ctx.language,
        speaker: ctx.speaker,
        tier: ctx.tier,
      });
      const ttsMs = Math.round(performance.now() - ttsStarted);

      // Silent provenance write (fire-and-forget). Capture the id so "Say it
      // again" can reference the original record (F-12).
      const isInstant = ctx.tier === "instant" && !ctx.chosenEmotion;
      const provPromise = logProvenance({
        timestamp: new Date().toISOString(),
        concepts: ctx.selectedConcepts,
        interpretationsShown: ctx.interpretationsShown ?? [],
        interpretationConfirmed: null,
        tierUsed: ctx.tier,
        expressionOptionsShown: isInstant ? [] : ctx.emotionOptions ?? [],
        finalApprovedText: textToSpeak,
        wasManuallyEdited: false,
        meta: buildProvenanceMeta({ latencyMs: { tts: ttsMs } }),
      });

      let audioSrc = "";
      if (ttsRes.audioBase64) {
        audioSrc = `data:${ttsRes.mimeType || "audio/wav"};base64,${ttsRes.audioBase64}`;
        const audio = new Audio(audioSrc);
        audioRef.current = audio;
        // Playback end is the real "done" signal (F-07): the message keeps
        // playing after `play()` resolves.
        audio.onended = () => {
          if (audioRef.current === audio) {
            audioRef.current = null;
            dispatch({ type: "SPEECH_DONE" });
            setSpeaking(false);
          }
        };
        await audio.play().catch((playErr) => {
          console.warn("[TTS] browser audio play blocked or unsupported:", playErr);
          audioRef.current = null;
          dispatch({ type: "SPEECH_DONE" });
          setSpeaking(false);
        });
      } else {
        dispatch({ type: "SPEECH_DONE" });
        setSpeaking(false);
      }

      const prov = await provPromise.catch(() => undefined);
      lastAudioRef.current = { src: audioSrc, text: textToSpeak, provenanceId: prov?.id };
      recordUsage(ctx.selectedConcepts); // F-10: powers the "Frequent" section
      flashNotification(`📢 Spoken: "${textToSpeak}"`);

      // Trust Ladder: register this use, keyed on the STABLE interpretation text
      // (not the emotion-coloured sentence) so full -> fast promotion still works
      // across different tone choices for the same concept set. Fire-and-forget.
      const ladderKeyText = ctx.interpretationText ?? textToSpeak;
      if (ctx.tier !== "instant") {
        void confirmTrustLadder(ctx.selectedConcepts, ladderKeyText)
          .then((res) => {
            if (res.entry.tier !== ctx.tier) {
              dispatch({ type: "SET_TIER", tier: res.entry.tier });
              if (res.entry.tier === "fast") {
                flashNotification("🚀 Promoted to Fast Tier — fewer tones to pick from next time.", 5000);
              }
            }
          })
          .catch((e) => console.warn("[TrustLadder] confirmation registration notice:", e));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "TTS speech synthesis failed";
      dispatch({ type: "ERROR", message: msg });
      setSpeaking(false);
    }
  }

  /** F-07: interrupt playback within ~100ms and log that the message was cut short. */
  function handleStopSpeech() {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      try {
        audio.currentTime = 0;
      } catch {
        /* some browsers throw if metadata isn't loaded yet */
      }
      audio.onended = null;
      audioRef.current = null;
    }
    dispatch({ type: "SPEECH_CANCELLED" });
    setSpeaking(false);
    flashNotification("⏹ Stopped.");

    void logProvenance({
      timestamp: new Date().toISOString(),
      concepts: ctx.selectedConcepts,
      interpretationsShown: ctx.interpretationsShown ?? [],
      interpretationConfirmed: null,
      tierUsed: ctx.tier,
      expressionOptionsShown: ctx.emotionOptions ?? [],
      finalApprovedText: ctx.stagedText ?? lastAudioRef.current?.text ?? "",
      wasManuallyEdited: false,
      meta: buildProvenanceMeta({ speechCancelled: true }),
    }).catch(() => undefined);
  }

  /**
   * F-07 / F-12: replay the cached clip. No new synthesis — the text is unchanged
   * and was already spoken. Still writes a provenance record referencing the original.
   */
  async function handleSayAgain() {
    const cached = lastAudioRef.current;
    if (!cached) return;
    if (cached.src) {
      const audio = new Audio(cached.src);
      audioRef.current = audio;
      setSpeaking(true);
      audio.onended = () => {
        if (audioRef.current === audio) audioRef.current = null;
        setSpeaking(false);
      };
      await audio.play().catch(() => {
        audioRef.current = null;
        setSpeaking(false);
      });
    }
    void logProvenance({
      timestamp: new Date().toISOString(),
      concepts: ctx.selectedConcepts,
      interpretationsShown: ctx.interpretationsShown ?? [],
      interpretationConfirmed: null,
      tierUsed: ctx.tier,
      expressionOptionsShown: ctx.emotionOptions ?? [],
      finalApprovedText: cached.text,
      wasManuallyEdited: false,
      meta: buildProvenanceMeta({ repeatOf: cached.provenanceId }),
    }).catch(() => undefined);
    flashNotification(`🔁 Repeated: "${cached.text}"`);
  }

  async function handlePinToInstant(pinnedText: string) {
    try {
      const res = await pinToInstant(ctx.selectedConcepts, pinnedText);
      dispatch({ type: "SET_TIER", tier: "instant", pinnedText: res.entry.pinnedText });
      setNotification(`📌 Combination pinned to Instant Tier! Future uses will speak immediately.`);
      setTimeout(() => setNotification(null), 5000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to pin combination";
      dispatch({ type: "ERROR", message: msg });
    }
  }

  async function handleUnpinFromInstant() {
    try {
      const res = await unpinFromInstant(ctx.selectedConcepts);
      dispatch({ type: "SET_TIER", tier: res.entry?.tier ?? "full" });
      setNotification(`✕ Unpinned from Instant tier. Tone selection restored.`);
      setTimeout(() => setNotification(null), 4000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to unpin combination";
      dispatch({ type: "ERROR", message: msg });
    }
  }

  // The emotion options actually offered: full tier shows 3, fast shows 2.
  const emotionOptionsForTier =
    ctx.emotionOptions?.slice(0, ctx.tier === "fast" ? 2 : 3);

  // F-15: announce each step transition and the final spoken text to screen readers.
  const stepLabel =
    ctx.state === "selecting"
      ? loading
        ? "Preparing tones"
        : emotionOptionsForTier
        ? "Choose a tone"
        : "Choose concepts"
      : ctx.state === "previewing"
      ? "Ready — about to speak"
      : ctx.state === "speaking"
      ? "Speaking"
      : "Spoken";
  useEffect(() => {
    announce(stepLabel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepLabel]);
  useEffect(() => {
    if (ctx.state === "spoken" && ctx.stagedText) {
      announce(ctx.wasCancelled ? "Playback stopped." : `Spoken aloud: ${ctx.stagedText}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.state]);

  // The brief pre-speech flash, then auto-advance to `speaking` (no tap required).
  useEffect(() => {
    if (ctx.state !== "previewing") return;
    const t = window.setTimeout(() => dispatch({ type: "PREVIEW_DONE" }), 1500);
    return () => window.clearTimeout(t);
  }, [ctx.state]);

  // Once the reducer says `speaking`, synthesise + play. Guarded so it fires once
  // per entry into `speaking` (and not again while `speaking` state is stable).
  const speakStartedRef = useRef(false);
  useEffect(() => {
    if (ctx.state === "speaking" && !speakStartedRef.current) {
      speakStartedRef.current = true;
      void speakStaged();
    } else if (ctx.state !== "speaking") {
      speakStartedRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.state]);

  // The Settings page is a dedicated view, not a step in the loop. It holds
  // Language/Voice and Accessibility off the home page; every control keeps the
  // same handlers and state it had before.
  if (view === "settings") {
    return (
      <SettingsPage
        onDone={() => setView("home")}
        busy={loading || speaking}
        language={ctx.language}
        languages={languages}
        onLanguageChange={(language) => dispatch({ type: "SET_LANGUAGE", language })}
        speaker={ctx.speaker}
        voices={voices}
        onSpeakerChange={(speaker) => dispatch({ type: "SET_SPEAKER", speaker })}
        settings={settings}
        onSettingsChange={updateSettings}
      />
    );
  }

  return (
    <>
      {/* Premium glass backdrop: animated aurora wash + a fine particle field.
          Both are purely decorative and disabled for reduced-motion / high-contrast. */}
      <div className="app-aurora" aria-hidden="true" data-glass-decor />
      {decorEnabled && (
        <Particles
          className="app-particles"
          quantity={90}
          ease={70}
          size={0.5}
          color={theme === "dark" ? "#a5b4fc" : "#6366f1"}
          data-glass-decor
        />
      )}

      {/* Brand Header — full viewport width: title hard left, Settings hard right.
          The theme toggle + add-tile live in a floating cluster (below), not here. */}
      <header className="app-header">
        <div className="brand-wrapper">
          <span className="brand-icon" aria-hidden="true">
            ✨
          </span>
          <h1 className="brand-title">
            <AuroraText colors={["#a5b4fc", "#2dd4bf", "#818cf8", "#38bdf8"]}>SWARA</AuroraText>
          </h1>
        </div>
        <div className="header-actions">
          <button
            id="btn-open-settings"
            type="button"
            className="secondary-button"
            onClick={() => setView("settings")}
            aria-label="Open settings menu"
          >
            ⚙️
          </button>
        </div>
      </header>

      {/* Floating controls — pinned to the top-right of the viewport, clear of
          the title bar. Theme toggle + add-your-own-tile. */}
      <div className="floating-controls">
        <AnimatedThemeToggler
          id="btn-toggle-theme"
          className="secondary-button theme-toggle-btn"
          theme={theme}
          onThemeChange={setTheme}
          variant="circle"
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        />
        <button
          id="btn-add-tile"
          type="button"
          className="secondary-button"
          onClick={() => setAdding(true)}
          aria-label="Add your own tile"
          aria-expanded={adding}
        >
          +
        </button>
      </div>

      <div className="app-container">
      {/* F-15: assertive live region for step transitions + final spoken text */}
      <div className="sr-only" role="status" aria-live="assertive" aria-atomic="true">
        {liveMessage}
      </div>

      {/* Global Notification Banner */}
      {notification && (
        <div className="notification-banner" role="alert">
          {notification}
        </div>
      )}

      {/* F-08: resume an interrupted composition */}
      {resumable && (
        <div className="resume-banner" role="dialog" aria-label="Resume your message">
          <div className="resume-text">
            <strong>You were in the middle of a message.</strong>{" "}
            {resumable.selectedConcepts.length > 0 && (
              <span>
                {resumable.selectedConcepts.map((c) => c.emoji).join(" ")} (
                {resumable.selectedConcepts.map((c) => c.label).join(", ")})
              </span>
            )}
          </div>
          <div className="resume-actions">
            <button id="btn-resume-session" type="button" className="primary-confirm-btn" onClick={handleResume}>
              Restore it
            </button>
            <button id="btn-dismiss-resume" type="button" className="secondary-button" onClick={handleDismissResume}>
              Start fresh
            </button>
          </div>
        </div>
      )}

      {/* Search (right-aligned) + the add-tile form; its "+" trigger is in the header (Step 1) — F-10 */}
      <div className="tile-search-row">
        <input
          type="search"
          className="palette-search"
          placeholder="Search tiles…"
          value={conceptSearch}
          onChange={(e) => setConceptSearch(e.target.value)}
          aria-label="Search concept tiles"
        />
      </div>
      <PalettePicker
        adding={adding}
        onCancelAdding={() => setAdding(false)}
        onAddConcept={(concept) => {
          handleAddUserConcept(concept);
          setAdding(false);
        }}
      />

      {/* Action 1: pick concept tiles + "Suggest tones" */}
      <ConceptGrid
        concepts={visibleConcepts}
        selected={ctx.selectedConcepts}
        tier={ctx.tier}
        pinnedText={ctx.stagedText}
        onToggle={handleToggleConcept}
        onSubmit={handleSubmit}
        onReorder={handleReorderTiles}
        onClear={handleClearConcepts}
        onUndoLast={handleUndoLastConcept}
        disabled={loading || ctx.state !== "selecting"}
      />

      {/* Action 2: pick an emotional tone (then it speaks automatically) */}
      {ctx.state === "selecting" && (loading || emotionOptionsForTier) && (
        <EmotionPicker
          loading={loading}
          options={emotionOptionsForTier ?? []}
          onChoose={handleChooseEmotion}
          disabled={speaking}
          decor={decorEnabled}
        />
      )}

      {/* Brief pre-speech flash of the exact sentence — no tap to dismiss */}
      {(ctx.state === "previewing" || ctx.state === "speaking") && ctx.stagedText && (
        <div
          className={`speak-flash glass-beam-host ${ctx.state === "speaking" ? "is-speaking" : ""}`}
          role="status"
          aria-live="polite"
        >
          {decorEnabled && (
            <BorderBeam
              size={140}
              duration={7}
              colorFrom={ctx.state === "speaking" ? "#2dd4bf" : "#818cf8"}
              colorTo={ctx.state === "speaking" ? "#6366f1" : "#c084fc"}
              data-glass-decor
            />
          )}
          <div className="speak-flash-body">
            {ctx.chosenEmotion && (
              <span className="speak-flash-emotion">
                <span aria-hidden="true">{emotionIcon(ctx.chosenEmotion)}</span> {ctx.chosenEmotion}
              </span>
            )}
            <blockquote className="speak-flash-text">&ldquo;{ctx.stagedText}&rdquo;</blockquote>
            <span className="speak-flash-caption">
              {ctx.state === "speaking" ? "Speaking…" : "Speaking in a moment…"}
            </span>
          </div>
          <button
            id="btn-stop-speech"
            type="button"
            className="speak-flash-stop"
            onClick={handleStopSpeech}
            aria-label="Stop speaking now"
          >
            ⏹ Stop
          </button>
        </div>
      )}

      {/* Post-speech: the sentence + a small non-blocking bar */}
      {ctx.state === "spoken" && ctx.stagedText && (
        <div className="spoken-bar glass-beam-host" role="status">
          {decorEnabled && (
            <BorderBeam size={120} duration={9} colorFrom="#34d399" colorTo="#2dd4bf" data-glass-decor />
          )}
          <blockquote className="spoken-bar-text">&ldquo;{ctx.stagedText}&rdquo;</blockquote>
          {ctx.wasCancelled && (
            <p className="speech-cancelled-note">Playback was stopped before it finished.</p>
          )}
          <div className="spoken-bar-actions">
            {lastAudioRef.current && (
              <button
                id="btn-say-again"
                type="button"
                className="secondary-button"
                onClick={handleSayAgain}
                disabled={speaking}
              >
                🔁 Say again
              </button>
            )}
            {ctx.tier === "instant" ? (
              <button
                id="btn-unpin-instant"
                type="button"
                className="secondary-button"
                onClick={handleUnpinFromInstant}
                disabled={speaking}
              >
                ✕ Unpin from Instant
              </button>
            ) : (
              <button
                id="btn-pin-instant"
                type="button"
                className="secondary-button"
                onClick={() => handlePinToInstant(ctx.stagedText!)}
                disabled={speaking}
                title="Always speak this exact phrase immediately for this concept set"
              >
                📌 Pin as Instant
              </button>
            )}
            <button
              id="btn-new-message"
              type="button"
              className="primary-button"
              onClick={handleClearConcepts}
              disabled={speaking}
            >
              ＋ New message
            </button>
          </div>
        </div>
      )}

      {/* Error display */}
      {ctx.error && (
        <div className="error-banner" role="alert">
          ⚠️ <strong>Error:</strong> {ctx.error}
        </div>
      )}
      </div>
    </>
  );
}
