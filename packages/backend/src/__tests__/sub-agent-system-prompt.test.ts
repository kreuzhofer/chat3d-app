import { describe, expect, it } from "vitest";
import { buildSubAgentSystemPrompt } from "../prompts/agent-system-prompt.js";

describe("buildSubAgentSystemPrompt — Phase 2 component function discipline", () => {
  const baseOptions = {
    componentName: "body",
    componentDescription: "the hollow box",
    overallContext: "a small enclosure",
  };

  it("instructs the LLM to write a function, not a __main__ block", () => {
    const prompt = buildSubAgentSystemPrompt(baseOptions);
    // Must mention the component function by name (e.g. "function `body() -> Part`" or "def body")
    expect(prompt).toMatch(/function [`']?body[(`'(]|def body/i);
    // Must explicitly forbid __main__
    expect(prompt).toMatch(/NOT write a `__main__` block|do not write.*__main__/i);
  });

  it("explains the standalone-render verification step", () => {
    const prompt = buildSubAgentSystemPrompt(baseOptions);
    // Must mention standalone rendering or isolation rendering
    expect(prompt).toMatch(/rendered.*isolation|standalone.*verification/i);
  });

  it("does not tell the agent to skip rendering (stale 'Do NOT render' instruction)", () => {
    const prompt = buildSubAgentSystemPrompt(baseOptions);
    // The old 'Do NOT render — just validate and submit' instruction should be gone
    expect(prompt).not.toMatch(/do not render.*just validate/i);
    expect(prompt).not.toMatch(/do not render.*orchestrator will handle/i);
  });
});
