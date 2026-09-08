import type { FC } from "react";
import type { A11ySettings } from "../lib/settings.ts";

export interface SettingsPanelProps {
  settings: A11ySettings;
  onChange: (patch: Partial<A11ySettings>) => void;
}

/**
 * Accessibility controls (Features.md F-15 §5): text scale, motion, scan speed,
 * dwell time, high-contrast, activation key — all persisted by the caller.
 *
 * These used to live in a pop-up panel on the home page; they are now a section
 * of the dedicated Settings page, so this renders just the control rows and
 * leaves the heading and "Done" affordance to the page around it.
 */
export const SettingsPanel: FC<SettingsPanelProps> = ({ settings, onChange }) => {
  return (
    <div className="settings-body">
      <label className="settings-row">
        <span>Text size</span>
        <input
          type="range"
          min={0.9}
          max={2}
          step={0.1}
          value={settings.textScale}
          onChange={(e) => onChange({ textScale: Number(e.target.value) })}
          aria-valuetext={`${Math.round(settings.textScale * 100)}%`}
        />
        <output>{Math.round(settings.textScale * 100)}%</output>
      </label>

      <label className="settings-row settings-toggle">
        <span>Reduce motion</span>
        <input
          type="checkbox"
          checked={settings.reduceMotion}
          onChange={(e) => onChange({ reduceMotion: e.target.checked })}
        />
      </label>

      <label className="settings-row settings-toggle">
        <span>High contrast</span>
        <input
          type="checkbox"
          checked={settings.highContrast}
          onChange={(e) => onChange({ highContrast: e.target.checked })}
        />
      </label>

      <label className="settings-row settings-toggle">
        <span>Switch scanning (single-key)</span>
        <input
          type="checkbox"
          checked={settings.scanEnabled}
          onChange={(e) => onChange({ scanEnabled: e.target.checked })}
        />
      </label>

      {settings.scanEnabled && (
        <>
          <label className="settings-row">
            <span>Scan speed</span>
            <input
              type="range"
              min={400}
              max={3000}
              step={100}
              value={settings.scanIntervalMs}
              onChange={(e) => onChange({ scanIntervalMs: Number(e.target.value) })}
            />
            <output>{(settings.scanIntervalMs / 1000).toFixed(1)}s</output>
          </label>
          <label className="settings-row">
            <span>Activation key</span>
            <input
              type="text"
              maxLength={1}
              className="settings-key-input"
              value={settings.activationKey === " " ? "Space" : settings.activationKey}
              onKeyDown={(e) => {
                e.preventDefault();
                onChange({ activationKey: e.key === "Spacebar" ? " " : e.key });
              }}
              readOnly
              aria-label="Press a key to set it as the scanning activation key"
            />
          </label>
        </>
      )}

      <label className="settings-row">
        <span>Dwell to click (eye-gaze)</span>
        <input
          type="range"
          min={0}
          max={3000}
          step={100}
          value={settings.dwellMs}
          onChange={(e) => onChange({ dwellMs: Number(e.target.value) })}
        />
        <output>{settings.dwellMs === 0 ? "off" : `${(settings.dwellMs / 1000).toFixed(1)}s`}</output>
      </label>
    </div>
  );
};
