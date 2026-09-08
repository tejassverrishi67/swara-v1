import { useState, type FC } from "react";
import type { Concept } from "@swara/shared";

export interface PalettePickerProps {
  /** True while the "add a tile" form should be shown. The "+" trigger lives in the header. */
  adding: boolean;
  onCancelAdding: () => void;
  onAddConcept: (concept: Concept) => void;
}

const EMOJI_CHOICES = ["🙂", "🖐️", "💊", "🥤", "🛏️", "📞", "🚗", "🏠", "👓", "🔑", "📺", "🐶"];

/**
 * The make-your-own-tile form (Features.md F-10). The "+" button that opens it
 * sits in the header next to Settings; this renders the form itself while
 * `adding` is true.
 */
export const PalettePicker: FC<PalettePickerProps> = ({ adding, onCancelAdding, onAddConcept }) => {
  const [newLabel, setNewLabel] = useState("");
  const [newEmoji, setNewEmoji] = useState(EMOJI_CHOICES[0]!);

  function submitNew() {
    const label = newLabel.trim();
    if (!label) return;
    const id = `user-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`;
    onAddConcept({ id, emoji: newEmoji, label, userDefined: true, category: "Mine" });
    setNewLabel("");
  }

  if (!adding) return null;

  return (
    <div className="palette-picker" role="group" aria-label="Add a concept tile">
      <div className="palette-add-form">
        <select value={newEmoji} onChange={(e) => setNewEmoji(e.target.value)} aria-label="Tile emoji">
          {EMOJI_CHOICES.map((em) => (
            <option key={em} value={em}>
              {em}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Label (what it means)"
          aria-label="Tile label"
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && submitNew()}
        />
        <button type="button" className="primary-confirm-btn" onClick={submitNew} disabled={!newLabel.trim()}>
          Add
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            setNewLabel("");
            onCancelAdding();
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};
