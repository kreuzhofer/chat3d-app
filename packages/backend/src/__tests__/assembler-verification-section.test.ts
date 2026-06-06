import { describe, expect, it } from "vitest";
import { buildAssemblyAgentSystemPrompt } from "../prompts/agent-system-prompt.js";

describe("assembler system prompt verification section", () => {
  it("includes an 'all passed' line when all components are clean", () => {
    const prompt = buildAssemblyAgentSystemPrompt({
      originalPrompt: "a box",
      assemblyNotes: "stack them",
      componentSummary: "- `components/body.py`: def body()",
      components: [
        {
          name: "body",
          verification: { passedCount: 3, failedCount: 0, uncertainCount: 0, failedItems: [] },
        },
      ],
    });
    expect(prompt).toMatch(/all sub-components passed/i);
  });

  it("lists failed components and their items when any have failures", () => {
    const prompt = buildAssemblyAgentSystemPrompt({
      originalPrompt: "a box",
      assemblyNotes: "stack them",
      componentSummary: "- `components/body.py`: def body()",
      components: [
        {
          name: "body",
          verification: {
            passedCount: 2,
            failedCount: 1,
            uncertainCount: 0,
            failedItems: [{ item: "wall=2mm", reasoning: "wall=1.5" }],
          },
        },
      ],
    });
    expect(prompt).toMatch(/Component "body"/);
    expect(prompt).toMatch(/wall=2mm/);
    expect(prompt).toMatch(/wall=1\.5/);
  });

  it("omits the 'failed verification items' section when no components have failures", () => {
    const prompt = buildAssemblyAgentSystemPrompt({
      originalPrompt: "a box",
      assemblyNotes: "stack them",
      componentSummary: "- `components/body.py`: def body()",
      components: [
        {
          name: "body",
          verification: { passedCount: 3, failedCount: 0, uncertainCount: 0, failedItems: [] },
        },
      ],
    });
    expect(prompt).not.toMatch(/failed verification items/i);
  });

  it("treats absent verification field (null) as 'all passed'", () => {
    // When a sub-agent ran without a checklist, verification is null.
    // The gate did not block the component, so we treat it as passed.
    const prompt = buildAssemblyAgentSystemPrompt({
      originalPrompt: "a box",
      assemblyNotes: "stack them",
      componentSummary: "- `components/body.py`: def body()",
      components: [
        {
          name: "body",
          // no verification field — component ran without a checklist
        },
      ],
    });
    expect(prompt).toMatch(/all sub-components passed/i);
    expect(prompt).not.toMatch(/failed verification items/i);
  });

  it("uses 'all passed' default when components array is omitted entirely", () => {
    // When called without a components array (legacy path), default to "all passed".
    const prompt = buildAssemblyAgentSystemPrompt({
      originalPrompt: "a box",
      assemblyNotes: "stack them",
      componentSummary: "- `components/body.py`: def body()",
    });
    expect(prompt).toMatch(/all sub-components passed/i);
  });

  it("includes best-effort instruction for assembler when failures exist", () => {
    const prompt = buildAssemblyAgentSystemPrompt({
      originalPrompt: "a box",
      assemblyNotes: "stack them",
      componentSummary: "- `components/body.py`: def body()",
      components: [
        {
          name: "body",
          verification: {
            passedCount: 1,
            failedCount: 2,
            uncertainCount: 0,
            failedItems: [
              { item: "width=10mm", reasoning: "width=8mm" },
              { item: "height=5mm", reasoning: "height not found" },
            ],
          },
        },
      ],
    });
    expect(prompt).toMatch(/best-effort/i);
    expect(prompt).toMatch(/Do NOT try to repair sub-component issues/);
    expect(prompt).toMatch(/width=10mm/);
    expect(prompt).toMatch(/height=5mm/);
  });

  it("treats UNCERTAIN-only components as 'all passed' (uncertain items don't surface)", () => {
    const prompt = buildAssemblyAgentSystemPrompt({
      originalPrompt: "a box",
      assemblyNotes: "stack them",
      componentSummary: "- `components/body.py`: def body()",
      components: [
        {
          name: "body",
          verification: { passedCount: 0, failedCount: 0, uncertainCount: 3, failedItems: [] },
        },
      ],
    });
    expect(prompt).toMatch(/all sub-components passed/i);
    expect(prompt).not.toMatch(/failed verification items/i);
  });
});
