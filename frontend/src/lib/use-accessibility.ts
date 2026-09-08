/**
 * React glue for the accessibility engine (Features.md F-15).
 * ==========================================================
 *
 * The testable logic lives in `scanning.ts` / `settings.ts`. This hook is the
 * thin DOM binding:
 *   - reflects settings onto <html>,
 *   - drives switch scanning over elements carrying `data-scan`, highlighting the
 *     current one and activating it on the configured key,
 *   - drives dwell activation (hover-to-click) over the same elements with a
 *     visible countdown, and
 *   - exposes an `announce()` for the live region.
 *
 * Deliberately dependency-light — no focus-trap library, no portal.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ScanController, type ScanTarget } from "./scanning.ts";
import { applySettings, type A11ySettings } from "./settings.ts";

export function useAccessibility(settings: A11ySettings) {
  const [liveMessage, setLiveMessage] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const controllerRef = useRef<ScanController | null>(null);

  const announce = useCallback((message: string) => {
    // Clear then set so screen readers re-announce an identical string.
    setLiveMessage("");
    window.setTimeout(() => setLiveMessage(message), 30);
  }, []);

  // Reflect settings onto the document root.
  useEffect(() => {
    applySettings(settings);
  }, [settings]);

  /* ── Switch scanning ────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!settings.scanEnabled) {
      controllerRef.current?.dispose();
      controllerRef.current = null;
      setHighlightId(null);
      return;
    }

    const controller = new ScanController({
      intervalMs: settings.scanIntervalMs,
      onChange: (s) => setHighlightId(s.highlightedId),
    });
    controllerRef.current = controller;

    // Prefer explicit `data-scan` targets; otherwise fall back to the visible,
    // enabled interactive controls inside the app — so scanning works across the
    // existing UI without every component opting in.
    const FALLBACK_SELECTOR =
      '.app-container button:not([disabled]), .app-container [role="radio"]:not([aria-disabled="true"]), ' +
      ".app-container select:not([disabled]), .app-container textarea:not([disabled]), " +
      '.app-container input:not([disabled]):not([type="range"])';

    const collect = (): ScanTarget[] => {
      const explicit = Array.from(document.querySelectorAll<HTMLElement>("[data-scan]"));
      const els = explicit.length > 0 ? explicit : Array.from(document.querySelectorAll<HTMLElement>(FALLBACK_SELECTOR));
      return els
        .filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null)
        .map((el, i) => {
          if (!el.id) el.id = `scan-target-${i}`;
          return {
            id: el.id,
            group: el.dataset.scanGroup,
            activate: () => el.click(),
          };
        });
    };

    controller.setTargets(collect());
    controller.start();

    // Re-collect when the DOM changes (new step rendered, options loaded, …).
    const observer = new MutationObserver(() => controller.setTargets(collect()));
    observer.observe(document.body, { childList: true, subtree: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === settings.activationKey) {
        e.preventDefault();
        controller.activate();
      } else if (e.key === "Escape") {
        controller.stop();
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      observer.disconnect();
      window.removeEventListener("keydown", onKey);
      controller.dispose();
    };
  }, [settings.scanEnabled, settings.scanIntervalMs, settings.activationKey]);

  // Keep the highlight class in sync with the controller.
  useEffect(() => {
    const prev = document.querySelectorAll(".scan-highlight");
    prev.forEach((el) => el.classList.remove("scan-highlight"));
    if (highlightId && !highlightId.startsWith("group:")) {
      document.getElementById(highlightId)?.classList.add("scan-highlight");
    }
  }, [highlightId]);

  /* ── Dwell activation (hover-to-click) ──────────────────────────────────── */
  useEffect(() => {
    if (settings.dwellMs <= 0) return;

    let timer: number | undefined;
    let armed: HTMLElement | null = null;

    const clearDwell = () => {
      if (timer) window.clearTimeout(timer);
      timer = undefined;
      armed?.classList.remove("dwell-arming");
      armed?.style.removeProperty("--dwell-ms");
      armed = null;
    };

    const onOver = (e: Event) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-scan]");
      if (!el || el.hasAttribute("disabled")) return;
      clearDwell();
      armed = el;
      el.style.setProperty("--dwell-ms", `${settings.dwellMs}ms`);
      el.classList.add("dwell-arming");
      timer = window.setTimeout(() => {
        el.classList.remove("dwell-arming");
        el.click();
        armed = null;
      }, settings.dwellMs);
    };

    document.body.addEventListener("mouseover", onOver);
    document.body.addEventListener("mouseout", clearDwell);
    return () => {
      document.body.removeEventListener("mouseover", onOver);
      document.body.removeEventListener("mouseout", clearDwell);
      clearDwell();
    };
  }, [settings.dwellMs]);

  return { liveMessage, announce, highlightId };
}
