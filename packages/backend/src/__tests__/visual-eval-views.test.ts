/**
 * The judge sees the same eight views from every entry point (ADR 0003).
 */
import { describe, it, expect } from "vitest";
import { STANDARD_VIEWS, selectStandardViews, MissingViewsError } from "../services/visual-eval-views.js";

const img = (angle: string) => ({ angle, base64: `IMG-${angle}` });
const nine = ["isometric", "ortho_45_bottom", "top", "front", "back", "bottom", "left", "right", "ortho_45"].map(img);

describe("selectStandardViews", () => {
  it("returns the eight standard views in canonical order and drops the rest", () => {
    const out = selectStandardViews(nine);
    expect(out.map((i) => i.angle)).toEqual([...STANDARD_VIEWS]);
    expect(out.find((i) => i.angle === "top")?.base64).toBe("IMG-top");
    expect(out.some((i) => i.angle === "isometric")).toBe(false);
  });

  it("refuses an incomplete set, naming what is missing", () => {
    const five = ["front", "top", "ortho_45", "left", "right"].map(img);
    expect(() => selectStandardViews(five)).toThrow(MissingViewsError);
    try { selectStandardViews(five); } catch (e) {
      expect((e as MissingViewsError).missing).toEqual(["back", "bottom", "ortho_45_bottom"]);
      expect((e as Error).message).toMatch(/missing: back, bottom, ortho_45_bottom/);
    }
  });

  it("refuses a duplicated view rather than picking one", () => {
    expect(() => selectStandardViews([...nine, img("front")])).toThrow(/Duplicate view "front"/);
  });

  it("refuses an empty set", () => {
    expect(() => selectStandardViews([])).toThrow(MissingViewsError);
  });
});
