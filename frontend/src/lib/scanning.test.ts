/**
 * Switch-access scanning engine (Features.md F-15).
 *
 * Timer is injected so the sweep is deterministic. The contract that matters:
 * the highlight advances, wraps, one activation selects the highlighted target,
 * and the full loop is completable with a single key.
 */

import { describe, expect, it, vi } from "vitest";
import { ScanController, type ScanTarget } from "./scanning.ts";

/** A controllable stand-in for setInterval. */
function fakeTimer() {
  let fn: (() => void) | null = null;
  return {
    setInterval: (f: () => void) => {
      fn = f;
      return 1;
    },
    clearInterval: () => {
      fn = null;
    },
    tick: () => fn?.(),
  };
}

const targets = (activated: string[]): ScanTarget[] =>
  ["a", "b", "c"].map((id) => ({ id, activate: () => activated.push(id) }));

describe("ScanController — single-level", () => {
  it("highlights the first target on start and advances on each tick, wrapping", () => {
    const timer = fakeTimer();
    const ctrl = new ScanController({ setInterval: timer.setInterval, clearInterval: timer.clearInterval });
    ctrl.setTargets(targets([]));
    ctrl.start();
    expect(ctrl.getState().highlightedId).toBe("a");
    timer.tick();
    expect(ctrl.getState().highlightedId).toBe("b");
    timer.tick();
    expect(ctrl.getState().highlightedId).toBe("c");
    timer.tick();
    expect(ctrl.getState().highlightedId).toBe("a"); // wrapped
  });

  it("activate() fires exactly the highlighted target", () => {
    const timer = fakeTimer();
    const hits: string[] = [];
    const ctrl = new ScanController({ setInterval: timer.setInterval, clearInterval: timer.clearInterval });
    ctrl.setTargets(targets(hits));
    ctrl.start();
    timer.tick(); // now on "b"
    ctrl.activate();
    expect(hits).toEqual(["b"]);
  });

  it("stop() clears the highlight and ignores later activations", () => {
    const timer = fakeTimer();
    const hits: string[] = [];
    const ctrl = new ScanController({ setInterval: timer.setInterval, clearInterval: timer.clearInterval });
    ctrl.setTargets(targets(hits));
    ctrl.start();
    ctrl.stop();
    expect(ctrl.getState().running).toBe(false);
    expect(ctrl.getState().highlightedId).toBeNull();
    ctrl.activate();
    expect(hits).toEqual([]);
  });

  it("auto-stops after maxLoops passes", () => {
    const timer = fakeTimer();
    const ctrl = new ScanController({
      setInterval: timer.setInterval,
      clearInterval: timer.clearInterval,
      maxLoops: 1,
    });
    ctrl.setTargets(targets([]));
    ctrl.start();
    timer.tick();
    timer.tick(); // a -> b -> c
    timer.tick(); // wrap => loop 1 => stop
    expect(ctrl.getState().running).toBe(false);
  });

  it("notifies onChange as the highlight moves", () => {
    const timer = fakeTimer();
    const onChange = vi.fn();
    const ctrl = new ScanController({
      setInterval: timer.setInterval,
      clearInterval: timer.clearInterval,
      onChange,
    });
    ctrl.setTargets(targets([]));
    ctrl.start();
    timer.tick();
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![0].highlightedId).toBe("b");
  });
});

describe("ScanController — two-level (group then item)", () => {
  it("scans groups first, descends on activate, then scans items in that group", () => {
    const timer = fakeTimer();
    const hits: string[] = [];
    const ctrl = new ScanController({ setInterval: timer.setInterval, clearInterval: timer.clearInterval });
    ctrl.setTargets([
      { id: "y", group: "answers", activate: () => hits.push("yes") },
      { id: "n", group: "answers", activate: () => hits.push("no") },
      { id: "h", group: "needs", activate: () => hits.push("help") },
    ]);
    ctrl.start();
    expect(ctrl.getState().level).toBe("group");
    expect(ctrl.getState().highlightedId).toBe("group:answers");

    ctrl.activate(); // descend into "answers"
    expect(ctrl.getState().level).toBe("item");
    expect(ctrl.getState().highlightedId).toBe("y");

    timer.tick(); // -> "n"
    ctrl.activate();
    expect(hits).toEqual(["no"]);
    // back to group level
    expect(ctrl.getState().level).toBe("group");
  });
});

describe("the whole loop with one key", () => {
  it("select → confirm → choose → speak, each step one activation", () => {
    const timer = fakeTimer();
    const log: string[] = [];
    const ctrl = new ScanController({ setInterval: timer.setInterval, clearInterval: timer.clearInterval });

    // Step 1: pick a concept
    ctrl.setTargets([
      { id: "concept-leg", activate: () => log.push("pick:leg") },
      { id: "check-meaning", activate: () => log.push("submit") },
    ]);
    ctrl.start();
    ctrl.activate(); // highlighted = concept-leg
    expect(log).toEqual(["pick:leg"]);

    // Step 2: confirm
    ctrl.setTargets([{ id: "confirm", activate: () => log.push("confirm") }]);
    ctrl.activate();

    // Step 3: choose phrasing
    ctrl.setTargets([{ id: "option-1", activate: () => log.push("choose:1") }]);
    ctrl.activate();

    // Step 4: speak
    ctrl.setTargets([{ id: "speak", activate: () => log.push("speak") }]);
    ctrl.activate();

    expect(log).toEqual(["pick:leg", "confirm", "choose:1", "speak"]);
  });
});
