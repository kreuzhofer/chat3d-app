/**
 * The judge training export's held-out cut widens by prompt (issue #95):
 * a training row that is another generation of a held-out prompt shares its
 * prompt and checklist with the measurement set, so it is held out too.
 */
import { describe, it, expect } from "vitest";
import { siblingsByPrompt } from "../services/training-export/judge-sft-held-out.js";

const rows = [
  { id: "h1", promptId: "pA" },
  { id: "h2", promptId: "pB" },
  { id: "s1", promptId: "pA" }, // another generation of a held-out prompt
  { id: "s2", promptId: "pA" },
  { id: "t1", promptId: "pC" }, // unrelated training row
];

describe("siblingsByPrompt", () => {
  it("names the held-out prompts and the rows that share them but are not held out themselves", () => {
    const { promptIds, siblingExampleIds } = siblingsByPrompt(new Set(["h1", "h2"]), rows);
    expect(promptIds).toEqual(["pA", "pB"]);
    expect(siblingExampleIds).toEqual(["s1", "s2"]);
  });

  it("returns nothing when no row shares a held-out prompt", () => {
    const { promptIds, siblingExampleIds } = siblingsByPrompt(new Set(["t1"]), rows);
    expect(promptIds).toEqual(["pC"]);
    expect(siblingExampleIds).toEqual([]);
  });

  it("is sorted and free of duplicates so two exports of one database agree", () => {
    const { siblingExampleIds } = siblingsByPrompt(new Set(["h2", "h1"]), [...rows].reverse());
    expect(siblingExampleIds).toEqual(["s1", "s2"]);
  });
});
