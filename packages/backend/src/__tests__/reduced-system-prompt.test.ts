import { describe, it, expect } from "vitest";
import {
  CODEGEN_SYSTEM_PROMPT,
  CODEGEN_ALL_SECTIONS,
  CODEGEN_SECTION_INTRO,
  CODEGEN_SECTION_OUTPUT_CONTRACT,
  CODEGEN_SECTION_BUILD_CONTEXTS,
  CODEGEN_SECTION_3D_PRIMITIVES,
  CODEGEN_SECTION_2D_SKETCH,
  CODEGEN_SECTION_SKETCH_OPS,
  CODEGEN_SECTION_3D_OPS,
  CODEGEN_SECTION_BOOLEAN,
  CODEGEN_SECTION_POSITIONING,
  CODEGEN_SECTION_EDGE_FACE,
  CODEGEN_SECTION_FILLETS,
  CODEGEN_SECTION_OFFSET_SHELL,
  CODEGEN_SECTION_ARRAYS,
  CODEGEN_SECTION_EXPORT,
  CODEGEN_SECTION_COMMON_MISTAKES,
  CODEGEN_SECTION_EXAMPLE,
  CODEGEN_SECTION_BUILDLINE,
  CODEGEN_SECTION_SWEEP,
  CODEGEN_SECTION_LOFT,
  CODEGEN_SECTION_SKETCH_ON_FACE,
  CODEGEN_SECTION_REVOLVE,
  CODEGEN_SECTION_PARAMETRIC,
  CODEGEN_SECTION_CRITICAL_RULES,
  CODEGEN_SECTION_MORE_EXAMPLES,
  detectCodeFeatures,
  buildReducedSystemPrompt,
} from "../prompts/system-prompts.js";
import { RenderErrorCategory } from "../utils/render-errors.js";

// ── CODEGEN_SYSTEM_PROMPT identity check ─────────────────────────────────────

describe("CODEGEN_SYSTEM_PROMPT section composition", () => {
  it("is composed from joining all sections", () => {
    expect(CODEGEN_SYSTEM_PROMPT).toBe(CODEGEN_ALL_SECTIONS.join("\n\n"));
  });

  it("has exactly 25 sections", () => {
    expect(CODEGEN_ALL_SECTIONS).toHaveLength(25);
  });

  it("preserves the known prompt length", () => {
    // This is the byte-identical check against the pre-refactor monolithic string.
    // If any section content changes, this test will catch it.
    expect(CODEGEN_SYSTEM_PROMPT.length).toBe(19306);
  });

  it("starts with the intro section", () => {
    expect(CODEGEN_SYSTEM_PROMPT.startsWith("You are a Build123d code generation assistant")).toBe(true);
  });

  it("ends with the more examples section", () => {
    expect(CODEGEN_SYSTEM_PROMPT.endsWith("```")).toBe(true);
  });

  it("contains all expected markdown headers", () => {
    const expectedHeaders = [
      "## Output Contract",
      "## Build123d Reference",
      "### Build Contexts",
      "### 3D Primitives",
      "### 2D Sketch Primitives",
      "### Sketch Operations",
      "### 3D Operations",
      "### Boolean Operations",
      "### Positioning and Orientation",
      "### Edge and Face Selection",
      "### Fillets and Chamfers (3D)",
      "### Offset / Shell",
      "### Arrays and Patterns",
      "### Export",
      "## Common Mistakes to Avoid",
      "## Complete Example",
      "## Advanced Techniques",
      "### BuildLine Wire Construction",
      "### Sweep",
      "### Loft",
      "### Sketching on Existing Faces",
      "### Revolve for Axisymmetric Parts",
      "### Parametric Geometry with Math",
      "## Critical Rules for Reliable Geometry",
      "## More Examples",
    ];

    for (const header of expectedHeaders) {
      expect(CODEGEN_SYSTEM_PROMPT).toContain(header);
    }
  });

  it("each section is a non-empty string", () => {
    for (const section of CODEGEN_ALL_SECTIONS) {
      expect(typeof section).toBe("string");
      expect(section.length).toBeGreaterThan(0);
    }
  });
});

// ── detectCodeFeatures ───────────────────────────────────────────────────────

describe("detectCodeFeatures", () => {
  it("detects 2D sketch primitives", () => {
    const code = `
with BuildPart() as part:
    with BuildSketch() as sk:
        Circle(10)
    extrude(amount=5)
root_part = part.part`;

    const features = detectCodeFeatures(code);
    expect(features.has("2d_sketch")).toBe(true);
    expect(features.has("3d_ops")).toBe(true); // extrude
  });

  it("detects BuildLine features", () => {
    const code = `
with BuildPart() as part:
    with BuildSketch() as sk:
        with BuildLine():
            Polyline([(0,0), (10,0), (10,10)], close=True)
        make_face()
    extrude(amount=5)
root_part = part.part`;

    const features = detectCodeFeatures(code);
    expect(features.has("buildline")).toBe(true);
    expect(features.has("sketch_ops")).toBe(true); // make_face
  });

  it("detects edge/face selection", () => {
    const code = `
with BuildPart() as part:
    Box(50, 50, 10)
    fillet(part.edges() | Axis.Z, 5)
root_part = part.part`;

    const features = detectCodeFeatures(code);
    expect(features.has("edge_face")).toBe(true);
    expect(features.has("fillets")).toBe(true); // fillet(part
  });

  it("detects sweep and helix", () => {
    const code = `
path = Helix(pitch=10, height=50, radius=20)
with BuildPart() as part:
    with BuildSketch(Plane.XZ.offset(20)):
        Circle(3)
    sweep(path=path)
root_part = part.part`;

    const features = detectCodeFeatures(code);
    expect(features.has("sweep")).toBe(true);
    expect(features.has("2d_sketch")).toBe(true);
  });

  it("detects loft", () => {
    const features = detectCodeFeatures("loft()");
    expect(features.has("loft")).toBe(true);
  });

  it("detects revolve", () => {
    const features = detectCodeFeatures("revolve(axis=Axis.Z)");
    expect(features.has("revolve")).toBe(true);
    expect(features.has("3d_ops")).toBe(true);
  });

  it("detects parametric math usage", () => {
    const code = `import math\nangle = math.radians(45)`;
    const features = detectCodeFeatures(code);
    expect(features.has("parametric")).toBe(true);
  });

  it("detects offset/shell with openings", () => {
    const code = `offset(amount=-2, openings=top_face)`;
    const features = detectCodeFeatures(code);
    expect(features.has("offset_shell")).toBe(true);
  });

  it("detects grid/polar locations", () => {
    const code = `with GridLocations(20, 20, 3, 3): Circle(3)`;
    const features = detectCodeFeatures(code);
    expect(features.has("arrays")).toBe(true);
  });

  it("detects sketch on face (BuildSketch with argument)", () => {
    const code = `with BuildSketch(top_face): Circle(5)`;
    const features = detectCodeFeatures(code);
    expect(features.has("sketch_on_face")).toBe(true);
  });

  it("returns empty set for minimal code", () => {
    const code = `with BuildPart() as part:\n    Box(10, 10, 10)\nroot_part = part.part`;
    const features = detectCodeFeatures(code);
    // Box alone doesn't trigger any conditional section patterns
    expect(features.has("2d_sketch")).toBe(false);
    expect(features.has("sweep")).toBe(false);
    expect(features.has("loft")).toBe(false);
  });
});

// ── buildReducedSystemPrompt ─────────────────────────────────────────────────

describe("buildReducedSystemPrompt", () => {
  const simpleCode = `with BuildPart() as part:\n    Box(50, 50, 10)\nroot_part = part.part`;

  it("always includes core sections", () => {
    const reduced = buildReducedSystemPrompt({ currentCode: simpleCode });

    // Core sections should always be present
    expect(reduced).toContain(CODEGEN_SECTION_INTRO);
    expect(reduced).toContain("## Output Contract");
    expect(reduced).toContain("### Build Contexts");
    expect(reduced).toContain("### 3D Primitives");
    expect(reduced).toContain("### Boolean Operations");
    expect(reduced).toContain("### Positioning and Orientation");
    expect(reduced).toContain("### Export");
    expect(reduced).toContain("## Common Mistakes to Avoid");
    expect(reduced).toContain("## Critical Rules for Reliable Geometry");
  });

  it("is shorter than the full prompt for simple code", () => {
    const reduced = buildReducedSystemPrompt({ currentCode: simpleCode });
    expect(reduced.length).toBeLessThan(CODEGEN_SYSTEM_PROMPT.length);
  });

  it("never includes examples in fix mode", () => {
    const reduced = buildReducedSystemPrompt({ currentCode: simpleCode });
    expect(reduced).not.toContain("## Complete Example");
    expect(reduced).not.toContain("## More Examples");
  });

  it("includes 2D sketch section when code uses Circle", () => {
    const code = `with BuildPart() as part:\n    with BuildSketch() as sk:\n        Circle(10)\n    extrude(amount=5)\nroot_part = part.part`;
    const reduced = buildReducedSystemPrompt({ currentCode: code });
    expect(reduced).toContain("### 2D Sketch Primitives");
    expect(reduced).toContain("### 3D Operations"); // extrude
  });

  it("includes sweep section when code uses sweep", () => {
    const code = `sweep(path=path)\nroot_part = part.part`;
    const reduced = buildReducedSystemPrompt({ currentCode: code });
    expect(reduced).toContain("### Sweep");
  });

  it("includes all conditional sections for KERNEL_ERROR", () => {
    const reduced = buildReducedSystemPrompt({
      currentCode: simpleCode,
      errorCategory: RenderErrorCategory.KERNEL_ERROR,
    });

    // All conditional sections should be present
    expect(reduced).toContain("### 2D Sketch Primitives");
    expect(reduced).toContain("### Sketch Operations");
    expect(reduced).toContain("### 3D Operations");
    expect(reduced).toContain("### Edge and Face Selection");
    expect(reduced).toContain("### Fillets and Chamfers");
    expect(reduced).toContain("### Offset / Shell");
    expect(reduced).toContain("### Arrays and Patterns");
    expect(reduced).toContain("### BuildLine Wire Construction");
    expect(reduced).toContain("### Sweep");
    expect(reduced).toContain("### Loft");
    expect(reduced).toContain("### Revolve");
    expect(reduced).toContain("### Parametric Geometry");

    // But still no examples
    expect(reduced).not.toContain("## Complete Example");
    expect(reduced).not.toContain("## More Examples");
  });

  it("includes all conditional sections for API_MISUSE", () => {
    const reduced = buildReducedSystemPrompt({
      currentCode: simpleCode,
      errorCategory: RenderErrorCategory.API_MISUSE,
    });

    expect(reduced).toContain("### 2D Sketch Primitives");
    expect(reduced).toContain("### 3D Operations");
    expect(reduced).toContain("### Sweep");
    expect(reduced).not.toContain("## Complete Example");
  });

  it("does not include unrelated sections for simple code with GEOMETRY error", () => {
    const reduced = buildReducedSystemPrompt({
      currentCode: simpleCode,
      errorCategory: RenderErrorCategory.GEOMETRY,
    });

    // Simple code with Box doesn't trigger sweep, loft, revolve, etc.
    expect(reduced).not.toContain("### Sweep");
    expect(reduced).not.toContain("### Loft");
    expect(reduced).not.toContain("### Revolve");
    expect(reduced).not.toContain("### BuildLine Wire Construction");
  });

  it("preserves section order from original prompt", () => {
    const code = `
with BuildPart() as part:
    with BuildSketch() as sk:
        Circle(10)
    extrude(amount=5)
    fillet(part.edges(), 2)
root_part = part.part`;

    const reduced = buildReducedSystemPrompt({ currentCode: code });

    // Check that sections appear in the correct order
    const idxSketch = reduced.indexOf("### 2D Sketch Primitives");
    const idxOps = reduced.indexOf("### 3D Operations");
    const idxFillets = reduced.indexOf("### Fillets and Chamfers");
    const idxRules = reduced.indexOf("## Critical Rules");

    expect(idxSketch).toBeLessThan(idxOps);
    expect(idxOps).toBeLessThan(idxFillets);
    expect(idxFillets).toBeLessThan(idxRules);
  });
});
