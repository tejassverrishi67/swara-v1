/**
 * GET  /api/palettes           — bundled starter boards (Features.md F-10)
 * POST /api/palettes/import    — import an Open Board Format (.obf) JSON board
 * =========================================================================
 *
 * OBF is the interchange format the existing AAC ecosystem (CoughDrop and
 * friends) uses. `.obz` is a zip of `.obf` files + images — that needs a zip
 * dependency, so this pass supports the single-board `.obf` JSON case, which is
 * dependency-free, and leaves `.obz` as a documented follow-up (SPEC.md §9).
 *
 * Framework-agnostic; server.ts adapts to Express.
 */

import type { Concept, ConceptPalette } from "@swara/shared";
import { BUNDLED_PALETTES } from "./boards.ts";

export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRequestError";
  }
}

export function listPalettes(): ConceptPalette[] {
  return BUNDLED_PALETTES;
}

/* ────────────────────────────────────────────────────────────────────────────
 * OBF import
 * ──────────────────────────────────────────────────────────────────────────── */

interface ObfButton {
  id?: string;
  label?: string;
  vocalization?: string;
  image_id?: string;
  "ext_symbol"?: unknown;
}
interface ObfImage {
  id?: string;
  data?: string; // data URI
  url?: string;
  path?: string;
}
interface ObfGrid {
  rows?: number;
  columns?: number;
  order?: Array<Array<string | null>>;
}
interface ObfBoard {
  format?: string;
  id?: string;
  name?: string;
  locale?: string;
  buttons?: ObfButton[];
  images?: ObfImage[];
  grid?: ObfGrid;
}

/** A rough emoji fallback so an imported button without an image still shows something. */
const FALLBACK_EMOJI = "🔤";

function slugify(s: string, fallback: string): string {
  const slug = s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

/**
 * Convert an OBF board object into a {@link ConceptPalette}. Tolerant of missing
 * optional fields; rejects only if there are no usable buttons.
 */
export function importOpenBoard(raw: unknown): ConceptPalette {
  if (typeof raw !== "object" || raw === null) {
    throw new InvalidRequestError("Body must be an Open Board Format (.obf) JSON object.");
  }
  const board = raw as ObfBoard;
  const buttons = Array.isArray(board.buttons) ? board.buttons : [];
  if (buttons.length === 0) {
    throw new InvalidRequestError("The board has no buttons to import.");
  }

  const imagesById = new Map<string, ObfImage>();
  for (const img of board.images ?? []) {
    if (img.id) imagesById.set(img.id, img);
  }

  const seen = new Set<string>();
  const concepts: Concept[] = [];
  for (let i = 0; i < buttons.length; i++) {
    const b = buttons[i]!;
    const label = (b.vocalization || b.label || "").trim();
    if (!label) continue;

    let id = slugify(b.id || label, `btn-${i}`);
    while (seen.has(id)) id = `${id}-${i}`;
    seen.add(id);

    const img = b.image_id ? imagesById.get(b.image_id) : undefined;
    const image = img?.data && /^data:/i.test(img.data) ? img.data : undefined;

    concepts.push({
      id,
      label,
      emoji: image ? "" : FALLBACK_EMOJI,
      ...(image ? { image } : {}),
      category: "Imported",
    });
  }

  if (concepts.length === 0) {
    throw new InvalidRequestError("None of the board's buttons had a usable label.");
  }

  const name = (board.name || "").trim() || "Imported board";
  return {
    id: `import-${slugify(board.id || name, "board")}`,
    name,
    locale: (board.locale || "en-IN").trim(),
    source: "import",
    categories: ["Imported"],
    concepts,
  };
}
