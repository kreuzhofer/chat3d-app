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

describe("ComponentChecklistItem with componentName tag", () => {
  it("accepts an item with componentName", () => {
    const r = ComponentChecklistItemSchema.safeParse({
      item: "Body is hollow",
      visibility: "visual",
      componentName: "body",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.componentName).toBe("body");
  });

  it("accepts an item without componentName (still valid)", () => {
    const r = ComponentChecklistItemSchema.safeParse({
      item: "x",
      visibility: "code",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.componentName).toBeUndefined();
  });

  it("rejects a non-string componentName", () => {
    const r = ComponentChecklistItemSchema.safeParse({
      item: "x",
      visibility: "code",
      componentName: 42,
    });
    expect(r.success).toBe(false);
  });

  it("rejects an empty string componentName", () => {
    const r = ComponentChecklistItemSchema.safeParse({
      item: "x",
      visibility: "code",
      componentName: "",
    });
    expect(r.success).toBe(false);
  });
});

describe("ComponentChecklistItem with assemblyVisibility", () => {
  it("accepts an item with assemblyVisibility=visible", () => {
    const r = ComponentChecklistItemSchema.safeParse({
      item: "x",
      visibility: "visual",
      assemblyVisibility: "visible",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.assemblyVisibility).toBe("visible");
  });

  it("accepts an item with assemblyVisibility=occluded", () => {
    const r = ComponentChecklistItemSchema.safeParse({
      item: "Pin diameter 3mm",
      visibility: "code",
      assemblyVisibility: "occluded",
    });
    expect(r.success).toBe(true);
  });

  it("accepts an item without assemblyVisibility (backwards compat)", () => {
    const r = ComponentChecklistItemSchema.safeParse({
      item: "x",
      visibility: "visual",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.assemblyVisibility).toBeUndefined();
  });

  it("rejects unknown assemblyVisibility value", () => {
    const r = ComponentChecklistItemSchema.safeParse({
      item: "x",
      visibility: "visual",
      assemblyVisibility: "hidden",
    });
    expect(r.success).toBe(false);
  });
});
