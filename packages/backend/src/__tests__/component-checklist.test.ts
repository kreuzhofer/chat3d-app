import { describe, expect, it } from "vitest";
import {
  ComponentChecklistItemSchema,
  ComponentChecklistSchema,
  parseComponentChecklist,
} from "../utils/component-checklist.js";

describe("ComponentChecklistItem schema", () => {
  it("accepts a valid item", () => {
    const r = ComponentChecklistItemSchema.safeParse({
      item: "Body is hollow",
      visibility: "visual",
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown visibility", () => {
    const r = ComponentChecklistItemSchema.safeParse({
      item: "x",
      visibility: "smell",
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty item text", () => {
    const r = ComponentChecklistItemSchema.safeParse({
      item: "",
      visibility: "code",
    });
    expect(r.success).toBe(false);
  });
});

describe("parseComponentChecklist", () => {
  it("returns the array for valid input", () => {
    const r = parseComponentChecklist([
      { item: "a", visibility: "visual" },
      { item: "b", visibility: "code" },
      { item: "c", visibility: "both" },
    ]);
    expect(r).toHaveLength(3);
  });

  it("returns null for invalid input (one bad item)", () => {
    const r = parseComponentChecklist([
      { item: "a", visibility: "visual" },
      { item: "b", visibility: "bogus" },
    ]);
    expect(r).toBeNull();
  });

  it("returns null for non-array input", () => {
    expect(parseComponentChecklist({ foo: 1 })).toBeNull();
    expect(parseComponentChecklist(null)).toBeNull();
  });
});
