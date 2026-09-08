import type { FC } from "react";
import type { LanguageInfo } from "../api-client.ts";

export interface LanguageSelectorProps {
  value: string;
  languages: LanguageInfo[];
  onChange: (code: string) => void;
  disabled?: boolean;
}

/**
 * Language picker (Features.md F-13). Sarvam Bulbul was chosen specifically for
 * Indian-language quality; before this the app had no way to reach it. Changing
 * the language feeds the interpretation and expression prompts too, not only TTS
 * — so the app warns that switching mid-message returns to concept selection.
 */
export const LanguageSelector: FC<LanguageSelectorProps> = ({
  value,
  languages,
  onChange,
  disabled,
}) => {
  if (languages.length === 0) return null;

  return (
    <div className="language-selector" role="group" aria-labelledby="language-label">
      <div className="audience-header">
        <label id="language-label" htmlFor="language-select" className="section-label">
          <span className="label-icon">🌐</span> Language
        </label>
        <span className="audience-hint">Interprets, phrases and speaks in this language</span>
      </div>

      <select
        id="language-select"
        className="language-select"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Message language"
      >
        {languages.map((l) => (
          <option key={l.code} value={l.code}>
            {l.name}
            {l.endonym && l.endonym !== l.name ? ` — ${l.endonym}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
};
