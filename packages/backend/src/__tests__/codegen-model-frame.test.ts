/**
 * The codegen agent is taught the Model frame and the prompt's Orientation
 * declaration (ADR 0007, issue #138), in both the tiered and the full prompt,
 * so a stated front feature is built at −Y.
 */
import { describe, it, expect } from "vitest";
import { buildAgentSystemPrompt, buildFullAgentSystemPrompt } from "../prompts/agent-system-prompt.js";

const declaration = { up: "the open top", front: "the short wall with the USB-C port" };

describe("the codegen system prompt", () => {
  it("states the Model frame even without a declaration", () => {
    for (const prompt of [
      buildAgentSystemPrompt({ promptText: "a box", isModification: false }),
      buildFullAgentSystemPrompt({ isModification: false }),
    ]) {
      expect(prompt).toContain("## Model frame");
      expect(prompt).toContain("front facing −Y");
      expect(prompt).not.toContain("Orientation declaration for this request");
    }
  });

  it("states the prompt's declaration", () => {
    for (const prompt of [
      buildAgentSystemPrompt({ promptText: "a box", isModification: false, orientation: declaration }),
      buildFullAgentSystemPrompt({ isModification: false, orientation: declaration }),
    ]) {
      expect(prompt).toContain("Orientation declaration for this request: up is the open top; the front (the −Y face) is the short wall with the USB-C port.");
    }
  });
});
