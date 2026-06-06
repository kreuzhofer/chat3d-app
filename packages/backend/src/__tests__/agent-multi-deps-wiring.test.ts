import { describe, expect, it } from "vitest";
import { aggregateChecklistForAssembler } from "../services/agent-multi.service.js";

describe("aggregateChecklistForAssembler", () => {
  it("flattens per-component checklists and tags items with componentName", () => {
    const result = aggregateChecklistForAssembler([
      {
        name: "body",
        description: "the box",
        componentChecklist: [
          { item: "Body is hollow", visibility: "visual" },
          { item: "Wall thickness is 2mm", visibility: "code" },
        ],
      },
      {
        name: "pin",
        description: "the pin",
        componentChecklist: [{ item: "Pin diameter is 3mm", visibility: "code" }],
      },
    ]);

    expect(result).toEqual([
      { item: "Body is hollow", visibility: "visual", componentName: "body" },
      { item: "Wall thickness is 2mm", visibility: "code", componentName: "body" },
      { item: "Pin diameter is 3mm", visibility: "code", componentName: "pin" },
    ]);
  });

  it("returns empty array when no components have checklists", () => {
    const result = aggregateChecklistForAssembler([
      { name: "body", description: "x" },
      { name: "pin", description: "y" },
    ]);
    expect(result).toEqual([]);
  });

  it("skips components with undefined componentChecklist", () => {
    const result = aggregateChecklistForAssembler([
      { name: "body", description: "x" },
      {
        name: "pin",
        description: "y",
        componentChecklist: [{ item: "x", visibility: "code" }],
      },
    ]);
    expect(result).toEqual([
      { item: "x", visibility: "code", componentName: "pin" },
    ]);
  });
});
