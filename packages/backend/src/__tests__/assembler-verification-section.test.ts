import { describe, expect, it } from "vitest";
import { buildAssemblyAgentSystemPrompt } from "../prompts/agent-system-prompt.js";

describe("assembler system prompt — v2 repair-authority block", () => {
  it("contains the explicit repair-authority instruction", () => {
    const prompt = buildAssemblyAgentSystemPrompt("user prompt", "asm notes", "comp summary");
    expect(prompt).toMatch(/final author of the result/i);
    expect(prompt).toMatch(/you may modify any sub-component's code/i);
  });

  it("mentions evaluate_checklist tool usage proactively", () => {
    const prompt = buildAssemblyAgentSystemPrompt("p", "a", "c");
    expect(prompt).toMatch(/evaluate_checklist/);
    expect(prompt).toMatch(/proactively/i);
  });

  it("describes the forced verification on submit", () => {
    const prompt = buildAssemblyAgentSystemPrompt("p", "a", "c");
    expect(prompt).toMatch(/forced verification will run/i);
    expect(prompt).toMatch(/UNCERTAIN items pass through/i);
  });

  it("does NOT contain the v1 'do not try to repair' instruction", () => {
    const prompt = buildAssemblyAgentSystemPrompt("p", "a", "c");
    expect(prompt).not.toMatch(/do not try to repair/i);
  });

  it("does NOT contain the v1 advisory 'all sub-components passed' line", () => {
    const prompt = buildAssemblyAgentSystemPrompt("p", "a", "c");
    expect(prompt).not.toMatch(/all sub-components passed/i);
  });

  it("repair-authority block appears after the assembly-section content", () => {
    const prompt = buildAssemblyAgentSystemPrompt("p", "a", "c");
    const assemblyIdx = prompt.indexOf("Assembly Instructions");
    const repairIdx = prompt.indexOf("final author of the result");
    expect(assemblyIdx).toBeGreaterThan(-1);
    expect(repairIdx).toBeGreaterThan(-1);
    expect(repairIdx).toBeGreaterThan(assemblyIdx);
  });
});
