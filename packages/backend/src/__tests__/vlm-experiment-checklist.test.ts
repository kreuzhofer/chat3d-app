/**
 * A VLM comparison experiment exists to score judges against production
 * ground truth. That only means anything if the experiment shows a judge the
 * same prompt production shows it — and until now it did not: the executor
 * passed prompt, category, complexity and spec, but never the verification
 * checklist, so every experiment evaluated with an empty question list while
 * the stored scores it is compared against had one.
 *
 * These tests pin the experiment's judge input to the production derivation
 * (issue #33's `deriveVisualChecklist`), including the legacy bare-string
 * criteria shape that the affected corpus actually holds.
 */
import { describe, it, expect } from "vitest";
import { buildExperimentEvalInput } from "../services/vlm-experiment-execution.service.js";

const images = [{ angle: "front", base64: "AAA" }];

function example(promptRef: Record<string, unknown>) {
  return {
    promptRef: {
      prompt: "a bracket",
      constructionSpec: "spec text",
      verificationChecklist: null,
      verificationCriteria: null,
      evalPlan: null,
      category: { name: "Hinges", complexity: 3 },
      ...promptRef,
    },
  };
}

describe("buildExperimentEvalInput", () => {
  it("passes the annotated criteria through as the judge's checklist", () => {
    const input = buildExperimentEvalInput(
      example({
        verificationCriteria: [
          { text: "Does it have two arms?", visibility: "visual" },
          { text: "Is the pin centred?", visibility: "both" },
        ],
      }),
      images,
    );
    expect(input.verificationChecklist).toEqual([
      "Does it have two arms?",
      "Is the pin centred?",
    ]);
  });

  it("accepts the legacy bare-string criteria shape without emitting undefined", () => {
    const input = buildExperimentEvalInput(
      example({ verificationCriteria: ["Does it have two arms?", "Is the pin centred?"] }),
      images,
    );
    expect(input.verificationChecklist).toEqual([
      "Does it have two arms?",
      "Is the pin centred?",
    ]);
    expect(input.verificationChecklist).not.toContain(undefined);
    expect(JSON.stringify(input.verificationChecklist)).not.toContain("undefined");
  });

  it("falls back to the plain checklist when no criterion is visual", () => {
    const input = buildExperimentEvalInput(
      example({
        verificationCriteria: [{ text: "Is the wall 2mm thick?", visibility: "code" }],
        verificationChecklist: ["Does it look like a hinge?"],
      }),
      images,
    );
    expect(input.verificationChecklist).toEqual(["Does it look like a hinge?"]);
  });

  it("carries the eval plan and construction spec", () => {
    const input = buildExperimentEvalInput(
      example({
        evalPlan: {
          systemPrompt: "Inspect the hinge.",
          inspectionPlan: { angles: ["front"], focus: { front: "the pin" } },
          suggestedCodeWeight: 0.4,
        },
      }),
      images,
    );
    expect(input.constructionSpec).toBe("spec text");
    expect(input.evalPlan?.inspectionPlan.focus).toEqual({ front: "the pin" });
  });

  it("drops a malformed eval plan rather than passing it on", () => {
    const input = buildExperimentEvalInput(
      example({ evalPlan: { inspectionPlan: { focus: { front: "the pin" } } } }),
      images,
    );
    expect(input.evalPlan).toBeNull();
  });

  it("keeps the prompt, category and images intact", () => {
    const input = buildExperimentEvalInput(example({}), images);
    expect(input.userPrompt).toBe("a bracket");
    expect(input.categoryName).toBe("Hinges");
    expect(input.complexity).toBe(3);
    expect(input.images).toEqual(images);
  });
});
