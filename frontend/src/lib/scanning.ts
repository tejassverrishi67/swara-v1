/**
 * Switch-access scanning (Features.md F-15)
 * ========================================
 *
 * The named audience includes people whose input device is a *single switch* or
 * eye gaze, not a finger. Scanning is the standard single-switch pattern: focus
 * auto-advances through a list of targets on a timer, and one activation press
 * selects the currently-highlighted target.
 *
 * `ScanController` is the engine — framework-agnostic, timer-driven, unit-tested.
 * A thin React hook wires it to the DOM (elements carrying `data-scan`), but the
 * stepping / wrap / activation logic all lives here so it can be tested without a
 * browser.
 *
 * Two-level (group → item) scanning is supported: give targets a `group` and the
 * controller first scans groups, then, on activation, scans items within the
 * chosen group.
 */

export interface ScanTarget {
  /** Stable id, usually the element id. */
  id: string;
  /** Optional group label for two-level scanning. */
  group?: string;
  /** Called when this target is activated. */
  activate: () => void;
}

export interface ScanControllerOptions {
  /** Milliseconds each target stays highlighted before advancing. */
  intervalMs?: number;
  /** After reaching the end, how many full passes before auto-stopping. 0 = never stop. */
  maxLoops?: number;
  /** Injected for tests. */
  setInterval?: (fn: () => void, ms: number) => number;
  clearInterval?: (handle: number) => void;
  /** Notified whenever the highlight moves or the mode changes. */
  onChange?: (state: ScanState) => void;
}

export interface ScanState {
  running: boolean;
  /** "group" while scanning group headers, "item" while scanning within a group. */
  level: "group" | "item";
  /** id of the currently-highlighted target, or null. */
  highlightedId: string | null;
  /** The group being scanned into, when level === "item". */
  activeGroup: string | null;
}

const DEFAULT_INTERVAL = 1200;

export class ScanController {
  private targets: ScanTarget[] = [];
  private groups: string[] = [];
  private opts: Required<Pick<ScanControllerOptions, "intervalMs" | "maxLoops">> &
    Pick<ScanControllerOptions, "onChange">;
  private readonly _setInterval: (fn: () => void, ms: number) => number;
  private readonly _clearInterval: (handle: number) => void;

  private handle: number | null = null;
  private cursor = 0;
  private loops = 0;
  private state: ScanState = {
    running: false,
    level: "group",
    highlightedId: null,
    activeGroup: null,
  };

  constructor(options: ScanControllerOptions = {}) {
    this.opts = {
      intervalMs: options.intervalMs ?? DEFAULT_INTERVAL,
      maxLoops: options.maxLoops ?? 0,
      onChange: options.onChange,
    };
    this._setInterval =
      options.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms) as unknown as number);
    this._clearInterval =
      options.clearInterval ?? ((h) => globalThis.clearInterval(h));
  }

  getState(): ScanState {
    return { ...this.state };
  }

  /** Replace the target list. Safe to call while running (restarts the sweep). */
  setTargets(targets: ScanTarget[]): void {
    this.targets = targets;
    this.groups = [...new Set(targets.map((t) => t.group).filter((g): g is string => !!g))];
    if (this.state.running) this.restartSweep();
  }

  setInterval(ms: number): void {
    this.opts.intervalMs = ms;
    if (this.state.running) this.restartSweep();
  }

  start(): void {
    if (this.state.running || this.targets.length === 0) return;
    this.state.running = true;
    this.state.level = this.groups.length > 1 ? "group" : "item";
    this.state.activeGroup = null;
    this.restartSweep();
  }

  stop(): void {
    if (this.handle != null) this._clearInterval(this.handle);
    this.handle = null;
    this.state = { running: false, level: "group", highlightedId: null, activeGroup: null };
    this.emit();
  }

  /** The single switch press. Selects the highlighted target (or descends into a group). */
  activate(): void {
    if (!this.state.running) return;
    if (this.state.level === "group") {
      const group = this.currentList()[this.cursor];
      if (typeof group === "string") {
        this.state.level = "item";
        this.state.activeGroup = group;
        this.restartSweep();
      }
      return;
    }
    const target = (this.currentList()[this.cursor] as ScanTarget | undefined) ?? undefined;
    if (target) {
      target.activate();
      // After activating an item, go back to group scanning (or restart the sweep).
      if (this.groups.length > 1) {
        this.state.level = "group";
        this.state.activeGroup = null;
      }
      this.restartSweep();
    }
  }

  /** Advance the highlight by one step (also driven internally by the timer). */
  step(): void {
    const list = this.currentList();
    if (list.length === 0) return;
    this.cursor += 1;
    if (this.cursor >= list.length) {
      this.cursor = 0;
      this.loops += 1;
      if (this.opts.maxLoops > 0 && this.loops >= this.opts.maxLoops) {
        this.stop();
        return;
      }
    }
    this.syncHighlight();
  }

  dispose(): void {
    if (this.handle != null) this._clearInterval(this.handle);
    this.handle = null;
  }

  /* ── internals ─────────────────────────────────────────────────────────── */

  private currentList(): Array<ScanTarget | string> {
    if (this.state.level === "group") return this.groups;
    if (this.state.activeGroup) {
      return this.targets.filter((t) => t.group === this.state.activeGroup);
    }
    return this.targets;
  }

  private restartSweep(): void {
    if (this.handle != null) this._clearInterval(this.handle);
    this.cursor = 0;
    this.loops = 0;
    this.syncHighlight();
    this.handle = this._setInterval(() => this.step(), this.opts.intervalMs);
  }

  private syncHighlight(): void {
    const item = this.currentList()[this.cursor];
    this.state.highlightedId =
      typeof item === "string" ? `group:${item}` : (item?.id ?? null);
    this.emit();
  }

  private emit(): void {
    this.opts.onChange?.(this.getState());
  }
}
