import { describe, expect, it } from "vitest";
import {
  detectPromptOperations,
  buildTieredSystemPrompt,
  CODEGEN_SYSTEM_PROMPT,
  CODEGEN_SECTION_FILLETS,
  CODEGEN_SECTION_SWEEP,
  CODEGEN_SECTION_BUILDLINE,
  CODEGEN_SECTION_LOFT,
  CODEGEN_SECTION_OFFSET_SHELL,
  CODEGEN_SECTION_REVOLVE,
  CODEGEN_SECTION_ARRAYS,
  CODEGEN_SECTION_PARAMETRIC,
  CODEGEN_SECTION_SKETCH_ON_FACE,
  CODEGEN_SECTION_EXAMPLE,
  CODEGEN_SECTION_MORE_EXAMPLES,
  CODEGEN_SECTION_INTRO,
  CODEGEN_SECTION_OUTPUT_CONTRACT,
  CODEGEN_SECTION_COMMON_MISTAKES,
  CODEGEN_SECTION_CRITICAL_RULES,
} from "../prompts/system-prompts.js";

// ── detectPromptOperations ───────────────────────────────────────────────

describe("detectPromptOperations", () => {
  it("always includes 3d_ops and 2d_sketch", () => {
    const ops = detectPromptOperations("a cube");
    expect(ops.has("3d_ops")).toBe(true);
    expect(ops.has("2d_sketch")).toBe(true);
  });

  it("detects fillets from 'rounded edges'", () => {
    const ops = detectPromptOperations("a box with rounded edges");
    expect(ops.has("fillets")).toBe(true);
  });

  it("detects fillets from 'fillet'", () => {
    const ops = detectPromptOperations("add a fillet to the top edges");
    expect(ops.has("fillets")).toBe(true);
  });

  it("detects fillets from 'chamfer'", () => {
    const ops = detectPromptOperations("chamfer the bottom edges");
    expect(ops.has("fillets")).toBe(true);
  });

  it("detects sweep from 'helical spring'", () => {
    const ops = detectPromptOperations("create a helical spring");
    expect(ops.has("sweep")).toBe(true);
  });

  it("detects sweep from 'thread'", () => {
    const ops = detectPromptOperations("a bolt with thread");
    expect(ops.has("sweep")).toBe(true);
  });

  it("detects loft from 'transition between shapes'", () => {
    const ops = detectPromptOperations("smooth transition between a circle and square");
    expect(ops.has("loft")).toBe(true);
  });

  it("detects loft from 'taper'", () => {
    const ops = detectPromptOperations("a tapered cylinder");
    expect(ops.has("loft")).toBe(true);
  });

  it("detects shell from 'hollow'", () => {
    const ops = detectPromptOperations("a hollow box");
    expect(ops.has("offset_shell")).toBe(true);
  });

  it("detects shell from 'thin wall'", () => {
    const ops = detectPromptOperations("enclosure with thin walls");
    expect(ops.has("offset_shell")).toBe(true);
  });

  it("detects arrays from 'grid' and 'pattern'", () => {
    const ops = detectPromptOperations("a grid of holes in a circular pattern");
    expect(ops.has("arrays")).toBe(true);
  });

  it("detects revolve from 'axisymmetric'", () => {
    const ops = detectPromptOperations("an axisymmetric vase");
    expect(ops.has("revolve")).toBe(true);
  });

  it("detects revolve from 'lathe'", () => {
    const ops = detectPromptOperations("lathe-turned part");
    expect(ops.has("revolve")).toBe(true);
  });

  it("detects buildline from 'cross section'", () => {
    const ops = detectPromptOperations("custom cross section profile");
    expect(ops.has("buildline")).toBe(true);
  });

  it("detects sketch_on_face from 'pocket'", () => {
    const ops = detectPromptOperations("box with a pocket on top");
    expect(ops.has("sketch_on_face")).toBe(true);
  });

  it("detects sketch_on_face from 'flange'", () => {
    const ops = detectPromptOperations("a bracket with mounting flanges");
    expect(ops.has("sketch_on_face")).toBe(true);
  });

  it("detects parametric from 'star'", () => {
    const ops = detectPromptOperations("a star shape");
    expect(ops.has("parametric")).toBe(true);
  });

  it("combines prompt and interpretation text", () => {
    // Prompt alone doesn't mention fillets, but interpretation does
    const ops = detectPromptOperations(
      "make a box",
      "A rectangular box with rounded edges and chamfered bottom",
    );
    expect(ops.has("fillets")).toBe(true);
  });

  it("returns only defaults for generic prompt with no operations", () => {
    const ops = detectPromptOperations("a cube");
    // Should have 3d_ops and 2d_sketch (always included) but not advanced ops
    expect(ops.has("3d_ops")).toBe(true);
    expect(ops.has("2d_sketch")).toBe(true);
    expect(ops.has("fillets")).toBe(false);
    expect(ops.has("sweep")).toBe(false);
    expect(ops.has("loft")).toBe(false);
    expect(ops.has("revolve")).toBe(false);
    expect(ops.has("arrays")).toBe(false);
  });

  it("is case-insensitive", () => {
    const ops = detectPromptOperations("A HOLLOW BOX WITH ROUNDED EDGES");
    expect(ops.has("offset_shell")).toBe(true);
    expect(ops.has("fillets")).toBe(true);
  });
});

// ── buildTieredSystemPrompt ──────────────────────────────────────────────

describe("buildTieredSystemPrompt", () => {
  it("includes core sections for minimal prompt", () => {
    const prompt = buildTieredSystemPrompt({ promptText: "a cube" });
    // Core sections should be present
    expect(prompt).toContain(CODEGEN_SECTION_INTRO);
    expect(prompt).toContain(CODEGEN_SECTION_OUTPUT_CONTRACT);
    expect(prompt).toContain(CODEGEN_SECTION_COMMON_MISTAKES);
    expect(prompt).toContain(CODEGEN_SECTION_CRITICAL_RULES);
  });

  it("excludes advanced sections for minimal prompt", () => {
    const prompt = buildTieredSystemPrompt({ promptText: "a cube", fewShotCount: 6 });
    expect(prompt).not.toContain(CODEGEN_SECTION_FILLETS);
    expect(prompt).not.toContain(CODEGEN_SECTION_SWEEP);
    expect(prompt).not.toContain(CODEGEN_SECTION_LOFT);
    expect(prompt).not.toContain(CODEGEN_SECTION_REVOLVE);
    expect(prompt).not.toContain(CODEGEN_SECTION_PARAMETRIC);
  });

  it("includes fillets section when fillets detected", () => {
    const prompt = buildTieredSystemPrompt({ promptText: "a box with rounded edges" });
    expect(prompt).toContain(CODEGEN_SECTION_FILLETS);
  });

  it("includes sweep section for spring prompt", () => {
    const prompt = buildTieredSystemPrompt({ promptText: "create a helical spring" });
    expect(prompt).toContain(CODEGEN_SECTION_SWEEP);
  });

  it("includes buildline for sweep along custom path prompt", () => {
    const prompt = buildTieredSystemPrompt({ promptText: "sweep a circle along a custom path" });
    expect(prompt).toContain(CODEGEN_SECTION_SWEEP);
    expect(prompt).toContain(CODEGEN_SECTION_BUILDLINE);
  });

  it("includes loft section for transition prompt", () => {
    const prompt = buildTieredSystemPrompt({ promptText: "loft between circle and square" });
    expect(prompt).toContain(CODEGEN_SECTION_LOFT);
  });

  it("includes arrays section for grid prompt", () => {
    const prompt = buildTieredSystemPrompt({ promptText: "grid of holes" });
    expect(prompt).toContain(CODEGEN_SECTION_ARRAYS);
  });

  it("includes shell section for hollow prompt", () => {
    const prompt = buildTieredSystemPrompt({ promptText: "hollow box" });
    expect(prompt).toContain(CODEGEN_SECTION_OFFSET_SHELL);
  });

  it("includes revolve section for axisymmetric prompt", () => {
    const prompt = buildTieredSystemPrompt({ promptText: "axisymmetric vase" });
    expect(prompt).toContain(CODEGEN_SECTION_REVOLVE);
  });

  it("includes sketch_on_face for pocket prompt", () => {
    const prompt = buildTieredSystemPrompt({ promptText: "box with a pocket on top" });
    expect(prompt).toContain(CODEGEN_SECTION_SKETCH_ON_FACE);
  });

  it("includes examples when fewShotCount <= 2", () => {
    const prompt = buildTieredSystemPrompt({ promptText: "a cube", fewShotCount: 1 });
    expect(prompt).toContain(CODEGEN_SECTION_EXAMPLE);
  });

  it("includes examples when fewShotCount is 0", () => {
    const prompt = buildTieredSystemPrompt({ promptText: "a cube", fewShotCount: 0 });
    expect(prompt).toContain(CODEGEN_SECTION_EXAMPLE);
  });

  it("includes examples when fewShotCount is not provided", () => {
    const prompt = buildTieredSystemPrompt({ promptText: "a cube" });
    expect(prompt).toContain(CODEGEN_SECTION_EXAMPLE);
  });

  it("excludes examples when fewShotCount > 2", () => {
    const prompt = buildTieredSystemPrompt({ promptText: "a cube", fewShotCount: 3 });
    expect(prompt).not.toContain(CODEGEN_SECTION_EXAMPLE);
  });

  it("includes MORE_EXAMPLES for advanced ops with sparse few-shots", () => {
    const prompt = buildTieredSystemPrompt({ promptText: "loft between shapes", fewShotCount: 0 });
    expect(prompt).toContain(CODEGEN_SECTION_MORE_EXAMPLES);
  });

  it("excludes MORE_EXAMPLES for advanced ops with enough few-shots", () => {
    const prompt = buildTieredSystemPrompt({ promptText: "loft between shapes", fewShotCount: 4 });
    expect(prompt).not.toContain(CODEGEN_SECTION_MORE_EXAMPLES);
  });

  it("is shorter than full CODEGEN_SYSTEM_PROMPT for simple prompts", () => {
    const tiered = buildTieredSystemPrompt({ promptText: "a cube", fewShotCount: 6 });
    expect(tiered.length).toBeLessThan(CODEGEN_SYSTEM_PROMPT.length);
  });

  it("never exceeds full prompt length", () => {
    // Even with everything detected, tiered should not exceed the full prompt
    const tiered = buildTieredSystemPrompt({
      promptText: "a hollow axisymmetric vase with rounded edges, a grid of holes, a loft transition, swept along a helical path, with pockets on the face, a custom star profile, and chamfered corners",
      fewShotCount: 0,
    });
    expect(tiered.length).toBeLessThanOrEqual(CODEGEN_SYSTEM_PROMPT.length);
  });

  it("uses spec interpretation for section detection", () => {
    // "a part" alone doesn't trigger fillets, but interpretation does
    const withoutInterp = buildTieredSystemPrompt({ promptText: "a part", fewShotCount: 6 });
    const withInterp = buildTieredSystemPrompt({
      promptText: "a part",
      interpretation: "A box with rounded edges and filleted corners",
      fewShotCount: 6,
    });
    expect(withoutInterp).not.toContain(CODEGEN_SECTION_FILLETS);
    expect(withInterp).toContain(CODEGEN_SECTION_FILLETS);
  });

  it("preserves section order from CODEGEN_ALL_SECTIONS", () => {
    const prompt = buildTieredSystemPrompt({
      promptText: "hollow box with filleted corners and a grid of holes",
      fewShotCount: 0,
    });
    // Verify order: INTRO should come before OFFSET_SHELL, OFFSET_SHELL before ARRAYS
    const introIdx = prompt.indexOf(CODEGEN_SECTION_INTRO);
    const shellIdx = prompt.indexOf(CODEGEN_SECTION_OFFSET_SHELL);
    const arraysIdx = prompt.indexOf(CODEGEN_SECTION_ARRAYS);
    expect(introIdx).toBeGreaterThanOrEqual(0);
    expect(shellIdx).toBeGreaterThanOrEqual(0);
    expect(arraysIdx).toBeGreaterThanOrEqual(0);
    expect(introIdx).toBeLessThan(shellIdx);
    expect(shellIdx).toBeLessThan(arraysIdx);
  });
});
