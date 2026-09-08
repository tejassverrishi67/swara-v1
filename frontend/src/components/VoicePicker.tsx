import type { FC } from "react";
import type { VoiceInfo } from "../api-client.ts";

export interface VoicePickerProps {
  value: string;
  voices: VoiceInfo[];
  onChange: (speakerId: string) => void;
  disabled?: boolean;
}

/**
 * Voice picker (Features.md F-14). Not just validation — a person's voice is part
 * of their identity, and letting an AAC user choose one that feels like *theirs*
 * matters. The list is already filtered server-side to voices valid for the
 * configured Bulbul model, so nothing here can 400 at speak time.
 */
export const VoicePicker: FC<VoicePickerProps> = ({ value, voices, onChange, disabled }) => {
  if (voices.length === 0) return null;

  return (
    <div className="voice-picker" role="group" aria-labelledby="voice-label">
      <div className="audience-header">
        <label id="voice-label" htmlFor="voice-select" className="section-label">
          <span className="label-icon">🎙️</span> Voice
        </label>
        <span className="audience-hint">
          {voices.find((v) => v.id === value)?.description ?? "Choose the voice that speaks for you"}
        </span>
      </div>

      <div className="voice-chips">
        {voices.map((v) => {
          const isSelected = v.id === value;
          return (
            <button
              key={v.id}
              id={`voice-chip-${v.id}`}
              type="button"
              className={`chip-button ${isSelected ? "active" : ""}`}
              aria-pressed={isSelected}
              disabled={disabled}
              onClick={() => onChange(v.id)}
              title={v.description}
            >
              {v.gender === "female" ? "👩 " : v.gender === "male" ? "👨 " : "🎙️ "}
              {v.name}
            </button>
          );
        })}
      </div>
    </div>
  );
};
