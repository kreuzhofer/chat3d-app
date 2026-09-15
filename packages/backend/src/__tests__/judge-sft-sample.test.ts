/**
 * One judge training sample (issue #94): the instrument over the labelled
 * items only, the eight views by relative path, the verdicts as the
 * assistant turn.
 */
import { describe, it, expect } from "vitest";
import { buildSample, USER_LEAD, type SampleExample } from "../services/training-export/judge-sft-sample.js";
import type { LabelledItem } from "../services/training-export/judge-sft-labels.js";
import { STANDARD_VIEWS } from "../services/visual-eval-views.js";

const example: SampleExample = {
  id: "ex-1", categoryName: "Boxes", complexity: 2, userPrompt: "A lidded box", constructionSpec: "- 40 mm cube\n- separate lid",
  screenshots: Object.fromEntries(STANDARD_VIEWS.map((v) => [v, `workbench/c/artifacts/ex-1-screenshot-${v}.png`])) as SampleExample["screenshots"],
};
const items: LabelledItem[] = [
  { exampleId: "ex-1", index: 3, question: "Is the lid separate?", pass: false, detail: "top: one body", source: "adjudicated", decision: "R", sittingId: "s1" },
  { exampleId: "ex-1", index: 1, question: "Is it a cube?", pass: true, detail: "front, right: equal sides", source: "agreed", decision: null, sittingId: "s1" },
];

describe("buildSample", () => {
  it("renders the instrument over the labelled items in corpus order and answers exactly them", () => {
    const { line, images, manifest } = buildSample(example, items, { score: 6, issues: ["no lid"], suggestions: [] });
    const messages = line.messages as Array<{ role: string; content: unknown }>;
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant"]);
    const system = messages[0].content as string;
    expect(system).toContain("1. Is it a cube?");
    expect(system).toContain("2. Is the lid separate?");
    expect(system).toContain("A lidded box");
    expect(system).toContain("separate lid");
    const assistant = JSON.parse(messages[2].content as string);
    expect(assistant).toEqual({
      score: 6, issues: ["no lid"], suggestions: [],
      checklist: [
        { question: "Is it a cube?", pass: true, detail: "front, right: equal sides" },
        { question: "Is the lid separate?", pass: false, detail: "top: one body" },
      ],
    });
    expect(manifest.items.map((i) => [i.position, i.corpusIndex, i.source])).toEqual([[1, 1, "agreed"], [2, 3, "adjudicated"]]);
    expect(manifest.source).toBe("adjudicated");
    expect(images).toHaveLength(8);
  });

  it("sends the eight views as image parts by relative path, labelled as the judge sees them", () => {
    const { line, images } = buildSample(example, items, undefined);
    const user = (line.messages as Array<{ content: Array<Record<string, unknown>> }>)[1].content;
    expect(user[0]).toEqual({ type: "text", text: USER_LEAD });
    expect(user[1]).toEqual({ type: "text", text: "Front view:" });
    expect(user[2]).toEqual({ type: "image_url", image_url: { url: "images/ex-1-front.png" } });
    expect(user).toHaveLength(1 + 2 * 8);
    expect(line.images).toEqual(images.map((i) => i.name));
    expect(images[0]).toEqual({ name: "images/ex-1-front.png", storagePath: "workbench/c/artifacts/ex-1-screenshot-front.png" });
    expect(user[user.length - 2]).toEqual({ type: "text", text: "45° up view:" });
  });

  it("carries an inline screenshot as bytes rather than a path", () => {
    const inline = { ...example, screenshots: { ...example.screenshots, top: `data:image/png;base64,${"A".repeat(20)}` } };
    const { images } = buildSample(inline, items, undefined);
    expect(images.find((i) => i.name.endsWith("-top.png"))).toEqual({ name: "images/ex-1-top.png", inline: inline.screenshots.top });
  });

  it("refuses an example missing a standard view", () => {
    const missing = { ...example, screenshots: { ...example.screenshots, bottom: "" } };
    expect(() => buildSample(missing, items, undefined)).toThrow(/no bottom view/);
  });
});
