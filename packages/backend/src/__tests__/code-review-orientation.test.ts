/**
 * The code reviewer gets the Orientation declaration (ADR 0007, issue #138)
 * and checks the direction items the request states — routed to it as code
 * items — from coordinates in the Model frame.
 */
import { describe, it, expect } from "vitest";
import { buildCodeReviewSystemPrompt } from "../prompts/code-review-system-prompt.js";

const criteria = [
  { text: "The USB-C opening is on the front face", visibility: "code" as const, role: "feature" as const },
  { text: "Exactly four standoffs", visibility: "visual" as const, role: "feature" as const },
];

describe("the code reviewer's prompt", () => {
  it("states the Model frame and the declaration, and how to check a side from coordinates", () => {
    const prompt = buildCodeReviewSystemPrompt({
      userPrompt: "a case with a USB-C opening on the front", annotatedCriteria: criteria,
      orientation: { up: "the open top", front: "the short wall with the USB-C opening" },
    });
    expect(prompt).toContain("## Model frame");
    expect(prompt).toContain("Orientation declaration for this request: up is the open top; the front (the −Y face) is the short wall with the USB-C opening.");
    expect(prompt).toMatch(/front = −Y/);
    expect(prompt).toMatch(/from the coordinates/);
  });

  it("asks the stated direction as a code item", () => {
    const prompt = buildCodeReviewSystemPrompt({ userPrompt: "a case", annotatedCriteria: criteria, orientation: null });
    expect(prompt).toContain("1. The USB-C opening is on the front face");
    expect(prompt).not.toContain("Exactly four standoffs");
  });

  it("states the frame without a declaration, for rows written before it", () => {
    const prompt = buildCodeReviewSystemPrompt({ userPrompt: "a case" });
    expect(prompt).toContain("## Model frame");
    expect(prompt).not.toContain("Orientation declaration for this request");
  });
});
