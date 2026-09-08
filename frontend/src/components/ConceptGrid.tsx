import type { FC } from "react";
import type { Concept, TrustTier } from "@swara/shared";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";

export interface ConceptGridProps {
  concepts: Concept[];
  selected: Concept[];
  onToggle: (concept: Concept) => void;
  onSubmit: () => void;
  /**
   * A quick tap still selects; a press-and-hold (~220 ms) then move rearranges.
   * Called with the dragged tile id and the id of the tile it was dropped onto —
   * the caller reorders + persists.
   */
  onReorder?: (activeId: string, overId: string) => void;
  /** Retained for callers; the on-screen tray that surfaced these was removed. */
  onClear?: () => void;
  onUndoLast?: () => void;
  disabled?: boolean;
  tier?: TrustTier;
  pinnedText?: string;
}

interface TileProps {
  concept: Concept;
  isSelected: boolean;
  selectionOrder?: number;
  disabled?: boolean;
  onToggle: (concept: Concept) => void;
}

/** One draggable + tappable concept tile. */
const SortableTile: FC<TileProps> = ({ concept, isSelected, selectionOrder, disabled, onToggle }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: concept.id,
    disabled,
  });

  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      id={`concept-tile-${concept.id}`}
      type="button"
      className={`concept-tile ${isSelected ? "selected" : ""} ${isDragging ? "dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // Selection is what `aria-pressed` should convey here (dnd-kit's own
      // attributes set it too, so this override must come last).
      aria-pressed={isSelected}
      disabled={disabled}
      onClick={() => onToggle(concept)}
      data-concept-id={concept.id}
    >
      {isSelected && (
        <span className="tile-order-badge" aria-hidden="true">
          ✓ {selectionOrder}
        </span>
      )}
      <span className="tile-emoji" aria-hidden="true">
        {concept.emoji}
      </span>
      <span className="tile-label">{concept.label}</span>
    </button>
  );
};

export const ConceptGrid: FC<ConceptGridProps> = ({
  concepts,
  selected,
  onToggle,
  onSubmit,
  onReorder,
  disabled,
  tier = "full",
  pinnedText,
}) => {
  const [dragId, setDragId] = useState<string | null>(null);

  // Map concept ID to its 1-indexed selection order
  const selectionOrderMap = new Map<string, number>();
  selected.forEach((c, idx) => {
    selectionOrderMap.set(c.id, idx + 1);
  });

  // Touch is the primary target: a quick tap falls straight through to onClick;
  // only a deliberate press-and-hold (with a generous 12px slop so a shaky hand
  // still counts as "held") starts a drag. A scroll gesture cancels it, so the
  // page still scrolls normally.
  const sensors = useSensors(
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 12 } }),
    useSensor(PointerSensor, { activationConstraint: { distance: 12 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragStart(e: DragStartEvent) {
    setDragId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setDragId(null);
    const { active, over } = e;
    if (over && active.id !== over.id) onReorder?.(String(active.id), String(over.id));
  }

  const dragged = dragId ? concepts.find((c) => c.id === dragId) : undefined;

  return (
    <section className="concept-grid-section" aria-label="Choose concepts">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragCancel={() => setDragId(null)}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={concepts.map((c) => c.id)} strategy={rectSortingStrategy}>
          <div className="tiles-grid" role="group" aria-label="Available concept tiles">
            {concepts.map((c) => {
              const selectionOrder = selectionOrderMap.get(c.id);
              return (
                <SortableTile
                  key={c.id}
                  concept={c}
                  isSelected={selectionOrder !== undefined}
                  selectionOrder={selectionOrder}
                  disabled={disabled}
                  onToggle={onToggle}
                />
              );
            })}
          </div>
        </SortableContext>

        <DragOverlay>
          {dragged ? (
            <div className="concept-tile dragging drag-overlay" aria-hidden="true">
              <span className="tile-emoji">{dragged.emoji}</span>
              <span className="tile-label">{dragged.label}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Primary Action Button */}
      <div className="action-row">
        <button
          id="btn-submit-concepts"
          type="button"
          className={`primary-button continue-button ${tier === "instant" ? "instant-btn" : ""}`}
          disabled={disabled || selected.length === 0}
          onClick={onSubmit}
          aria-label={
            tier === "instant"
              ? `Speak instantly: ${pinnedText}`
              : `Suggest tones for ${selected.length} concepts`
          }
        >
          {tier === "instant" ? (
            <>
              <span className="btn-icon">⚡</span>
              <span>Speak Instantly: &ldquo;{pinnedText}&rdquo;</span>
            </>
          ) : (
            <>
              <span>Suggest tones ({selected.length}) →</span>
            </>
          )}
        </button>
      </div>
    </section>
  );
};
