import type { FC } from "react";
import type { ExpressionOption } from "@swara/shared";
import { emotionIcon } from "../lib/emotion.ts";
import { ShineBorder } from "@/components/ui/shine-border.tsx";

export interface EmotionPickerProps {
  /** The pre-generated, fidelity-checked options (already sliced to the tier's count). */
  options: ExpressionOption[];
  /** True while the silent interpret + generate calls are still running. */
  loading?: boolean;
  /** User tapped a tone — this is the 2nd and final user action; it speaks next. */
  onChoose: (option: ExpressionOption) => void;
  disabled?: boolean;
  /** Render the premium animated shine border (off for reduced-motion / high-contrast). */
  decor?: boolean;
}

/**
 * Step 2 of the 2-action flow: tap one AI-suggested emotional tone. Each option
 * already carries the exact fidelity-checked sentence; tapping stages it and the
 * app flashes then speaks it automatically — there is no further confirmation.
 * The sentences themselves are deliberately NOT shown here (they flash after the
 * tap) so the choice stays a fast, low-reading-load emotion pick.
 */
export const EmotionPicker: FC<EmotionPickerProps> = ({
  options,
  loading,
  onChoose,
  disabled,
  decor,
}) => {
  return (
    <section className="emotion-picker glass-beam-host" aria-label="Choose an emotional tone">
      {decor && (
        <ShineBorder
          borderWidth={1.5}
          duration={12}
          shineColor={["#a5b4fc", "#2dd4bf", "#c084fc"]}
          data-glass-decor
        />
      )}
      <div className="emotion-picker-header">
        <span className="label-icon" aria-hidden="true">
          🎭
        </span>
        <span className="emotion-picker-hint">
          {loading
            ? "Thinking of a few ways to say this…"
            : "Tap the tone that fits how you feel — it speaks straight away"}
        </span>
      </div>

      <div className="emotion-tags" role="group" aria-label="Emotional tones">
        {loading
          ? [0, 1, 2].map((i) => <span key={i} className="emotion-tag skeleton" aria-hidden="true" />)
          : options.map((opt, i) => (
              <button
                key={`${opt.emotion}-${i}`}
                id={`emotion-tag-${i + 1}`}
                type="button"
                className="emotion-tag"
                disabled={disabled}
                onClick={() => onChoose(opt)}
              >
                <span className="emotion-tag-icon" aria-hidden="true">
                  {emotionIcon(opt.emotion)}
                </span>
                <span className="emotion-tag-label">{opt.emotion}</span>
              </button>
            ))}
      </div>
    </section>
  );
};
