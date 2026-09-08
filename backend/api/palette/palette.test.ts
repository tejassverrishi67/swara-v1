/**
 * Concept palettes + OBF import (Features.md F-10).
 */

import { describe, expect, it } from "vitest";
import { importOpenBoard, InvalidRequestError, listPalettes } from "./handler.ts";

describe("listPalettes", () => {
  it("ships the three bundled starter boards, each internally consistent", () => {
    const palettes = listPalettes();
    expect(palettes.map((p) => p.id)).toEqual(["medical", "daily-needs", "social"]);
    for (const p of palettes) {
      expect(p.concepts.length).toBeGreaterThan(10);
      expect(p.source).toBe("bundled");
      // every concept's category is one the palette declares
      for (const c of p.concepts) {
        expect(p.categories).toContain(c.category);
        expect(c.id).toBeTruthy();
        expect(c.label).toBeTruthy();
      }
      // ids are unique within a board
      expect(new Set(p.concepts.map((c) => c.id)).size).toBe(p.concepts.length);
    }
  });
});

describe("importOpenBoard", () => {
  const board = {
    format: "open-board-0.1",
    id: "b1",
    name: "My board",
    locale: "en-IN",
    buttons: [
      { id: "1", label: "water", image_id: "img1" },
      { id: "2", label: "help", vocalization: "I need help" },
      { id: "3", label: "" }, // no label — skipped
    ],
    images: [{ id: "img1", data: "data:image/png;base64,AAAA" }],
  };

  it("maps buttons to concepts, preferring vocalization and resolving images", () => {
    const palette = importOpenBoard(board);
    expect(palette.source).toBe("import");
    expect(palette.name).toBe("My board");
    expect(palette.concepts).toHaveLength(2);

    const [water, help] = palette.concepts;
    expect(water!.label).toBe("water");
    expect(water!.image).toBe("data:image/png;base64,AAAA");
    expect(help!.label).toBe("I need help"); // vocalization wins over label
    expect(help!.emoji).toBeTruthy(); // fallback emoji when no image
  });

  it("gives every imported concept a unique id", () => {
    const dup = {
      name: "d",
      buttons: [
        { label: "go" },
        { label: "go" },
        { label: "go" },
      ],
    };
    const ids = importOpenBoard(dup).concepts.map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("rejects a board with no usable buttons", () => {
    expect(() => importOpenBoard({ name: "x", buttons: [] })).toThrow(InvalidRequestError);
    expect(() => importOpenBoard({ name: "x", buttons: [{ label: "" }] })).toThrow(InvalidRequestError);
    expect(() => importOpenBoard(null)).toThrow(InvalidRequestError);
    expect(() => importOpenBoard("not an object")).toThrow(InvalidRequestError);
  });
});
