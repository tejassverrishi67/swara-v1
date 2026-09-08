import type { FC } from "react";
import type { LanguageInfo, VoiceInfo } from "../api-client.ts";
import type { A11ySettings } from "../lib/settings.ts";
import { LanguageSelector } from "./LanguageSelector.tsx";
import { VoicePicker } from "./VoicePicker.tsx";
import { SettingsPanel } from "./SettingsPanel.tsx";

export interface SettingsPageProps {
  /** Return to the home / communication-loop view. */
  onDone: () => void;
  /** True while a message is being interpreted or spoken — mirrors the home page. */
  busy?: boolean;

  /* Section 1 — Language & Voice (F-13 / F-14) */
  language: string;
  languages: LanguageInfo[];
  onLanguageChange: (code: string) => void;
  speaker: string;
  voices: VoiceInfo[];
  onSpeakerChange: (id: string) => void;

  /* Section 2 — Accessibility (F-15) */
  settings: A11ySettings;
  onSettingsChange: (patch: Partial<A11ySettings>) => void;
}

/**
 * The dedicated Settings page. Everything here is a relocation of controls that
 * used to sit on the home page (or in its pop-up panel); none of the underlying
 * behaviour changed. Kept out of the communication loop so the home page is just
 * Choose Concepts → Meaning Check → Choose Phrasing → Speak.
 */
export const SettingsPage: FC<SettingsPageProps> = ({
  onDone,
  busy,
  language,
  languages,
  onLanguageChange,
  speaker,
  voices,
  onSpeakerChange,
  settings,
  onSettingsChange,
}) => {
  return (
    <div className="app-container settings-page">
      <header className="app-header">
        <button
          id="btn-settings-back"
          type="button"
          className="secondary-button"
          onClick={onDone}
          aria-label="Back to home"
        >
          ← Back
        </button>
        <h1 className="brand-title">Settings</h1>
        <button id="btn-settings-done" type="button" className="secondary-button" onClick={onDone}>
          Done
        </button>
      </header>

      <section className="settings-panel" aria-labelledby="settings-langvoice-title">
        <h2 id="settings-langvoice-title" className="settings-title">
          🌐 Language &amp; Voice
        </h2>
        <div className="lang-voice-row">
          <LanguageSelector
            value={language}
            languages={languages}
            disabled={busy}
            onChange={onLanguageChange}
          />
          <VoicePicker value={speaker} voices={voices} disabled={busy} onChange={onSpeakerChange} />
        </div>
      </section>

      <section className="settings-panel" aria-labelledby="settings-a11y-title">
        <h2 id="settings-a11y-title" className="settings-title">
          ⚙️ Accessibility
        </h2>
        <SettingsPanel settings={settings} onChange={onSettingsChange} />
      </section>
    </div>
  );
};
