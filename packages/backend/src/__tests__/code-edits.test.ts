import { describe, it, expect } from "vitest";
import {
  parseEditResponse,
  applyEdits,
  shouldUseEditMode,
  type SearchReplaceEdit,
} from "../utils/code-edits.js";
import { RenderErrorCategory } from "../utils/render-errors.js";

// ── parseEditResponse ────────────────────────────────────────────────────────

describe("parseEditResponse", () => {
  it("parses a single search-and-replace edit", () => {
    const raw = `Here is the fix:

<<<SEARCH
    Box(50, 50, 10)
===
    Box(60, 60, 10)
>>>SEARCH

This changes the box dimensions.`;

    const result = parseEditResponse(raw);
    expect(result.isFullRewrite).toBe(false);
    expect(result.edits).toHaveLength(1);
    expect(result.edits[0].searchBlock).toBe("    Box(50, 50, 10)");
    expect(result.edits[0].replaceBlock).toBe("    Box(60, 60, 10)");
  });

  it("parses multiple search-and-replace edits", () => {
    const raw = `Two fixes needed:

<<<SEARCH
    Box(50, 50, 10)
===
    Box(60, 60, 10)
>>>SEARCH

<<<SEARCH
    Cylinder(5, 20, mode=Mode.SUBTRACT)
===
    Cylinder(8, 20, mode=Mode.SUBTRACT)
>>>SEARCH
`;

    const result = parseEditResponse(raw);
    expect(result.isFullRewrite).toBe(false);
    expect(result.edits).toHaveLength(2);
    expect(result.edits[0].searchBlock).toBe("    Box(50, 50, 10)");
    expect(result.edits[1].searchBlock).toBe("    Cylinder(5, 20, mode=Mode.SUBTRACT)");
  });

  it("parses a full rewrite with code fence", () => {
    const raw = `The code needs a complete rewrite:

<<<FULL_REWRITE
\`\`\`python
with BuildPart() as part:
    Box(100, 100, 20)

root_part = part.part
\`\`\`
>>>FULL_REWRITE
`;

    const result = parseEditResponse(raw);
    expect(result.isFullRewrite).toBe(true);
    expect(result.fullRewriteCode).toBe(
      "with BuildPart() as part:\n    Box(100, 100, 20)\n\nroot_part = part.part",
    );
    expect(result.edits).toHaveLength(0);
  });

  it("parses a full rewrite without code fence", () => {
    const raw = `<<<FULL_REWRITE
with BuildPart() as part:
    Box(100, 100, 20)

root_part = part.part
>>>FULL_REWRITE`;

    const result = parseEditResponse(raw);
    expect(result.isFullRewrite).toBe(true);
    expect(result.fullRewriteCode).toBe(
      "with BuildPart() as part:\n    Box(100, 100, 20)\n\nroot_part = part.part",
    );
  });

  it("returns empty edits for response with no edit blocks", () => {
    const raw = `\`\`\`python
with BuildPart() as part:
    Box(60, 60, 10)

root_part = part.part
\`\`\``;

    const result = parseEditResponse(raw);
    expect(result.isFullRewrite).toBe(false);
    expect(result.edits).toHaveLength(0);
  });

  it("handles malformed edit block (missing separator)", () => {
    const raw = `<<<SEARCH
    Box(50, 50, 10)
    Box(60, 60, 10)
>>>SEARCH`;

    const result = parseEditResponse(raw);
    // Without the === separator, the regex won't match
    expect(result.edits).toHaveLength(0);
  });

  it("prefers full rewrite over edit blocks when both present", () => {
    const raw = `<<<SEARCH
    Box(50, 50, 10)
===
    Box(60, 60, 10)
>>>SEARCH

<<<FULL_REWRITE
\`\`\`python
with BuildPart() as part:
    Box(100, 100, 20)
root_part = part.part
\`\`\`
>>>FULL_REWRITE`;

    const result = parseEditResponse(raw);
    expect(result.isFullRewrite).toBe(true);
    expect(result.edits).toHaveLength(0);
  });
});

// ── applyEdits ───────────────────────────────────────────────────────────────

describe("applyEdits", () => {
  const sampleCode = `# Parameters
box_width = 50  # mm
box_height = 10  # mm
hole_radius = 5  # mm

with BuildPart() as part:
    Box(box_width, box_width, box_height)
    Cylinder(hole_radius, box_height, mode=Mode.SUBTRACT)

root_part = part.part`;

  it("applies an exact match edit", () => {
    const edits: SearchReplaceEdit[] = [
      {
        searchBlock: "box_width = 50  # mm",
        replaceBlock: "box_width = 60  # mm",
      },
    ];

    const result = applyEdits(sampleCode, edits);
    expect(result.success).toBe(true);
    expect(result.appliedCount).toBe(1);
    expect(result.failedSearches).toHaveLength(0);
    expect(result.resultCode).toContain("box_width = 60  # mm");
    expect(result.resultCode).not.toContain("box_width = 50  # mm");
  });

  it("reports no-match for search block not in code", () => {
    const edits: SearchReplaceEdit[] = [
      {
        searchBlock: "Sphere(10)",
        replaceBlock: "Sphere(20)",
      },
    ];

    const result = applyEdits(sampleCode, edits);
    expect(result.success).toBe(false);
    expect(result.appliedCount).toBe(0);
    expect(result.failedSearches).toHaveLength(1);
    expect(result.failedSearches[0]).toContain("no match");
  });

  it("reports duplicate match when search appears multiple times", () => {
    // box_width appears multiple times, but the specific line "box_width = 50  # mm" appears once
    // Let's create a case where the search appears twice
    const codeWithDupes = `x = 10
x = 10
y = 20`;

    const edits: SearchReplaceEdit[] = [
      {
        searchBlock: "x = 10",
        replaceBlock: "x = 15",
      },
    ];

    const result = applyEdits(codeWithDupes, edits);
    expect(result.success).toBe(false);
    expect(result.appliedCount).toBe(0);
    expect(result.failedSearches).toHaveLength(1);
    expect(result.failedSearches[0]).toContain("2 matches");
  });

  it("handles trailing whitespace normalization", () => {
    const codeWithTrailingSpaces = "box_width = 50  # mm   \nbox_height = 10  # mm";
    const edits: SearchReplaceEdit[] = [
      {
        searchBlock: "box_width = 50  # mm",
        replaceBlock: "box_width = 60  # mm",
      },
    ];

    const result = applyEdits(codeWithTrailingSpaces, edits);
    expect(result.success).toBe(true);
    expect(result.appliedCount).toBe(1);
    expect(result.resultCode).toContain("box_width = 60  # mm");
  });

  it("applies multiple edits sequentially", () => {
    const edits: SearchReplaceEdit[] = [
      {
        searchBlock: "box_width = 50  # mm",
        replaceBlock: "box_width = 60  # mm",
      },
      {
        searchBlock: "hole_radius = 5  # mm",
        replaceBlock: "hole_radius = 8  # mm",
      },
    ];

    const result = applyEdits(sampleCode, edits);
    expect(result.success).toBe(true);
    expect(result.appliedCount).toBe(2);
    expect(result.resultCode).toContain("box_width = 60  # mm");
    expect(result.resultCode).toContain("hole_radius = 8  # mm");
  });

  it("handles multi-line search and replace", () => {
    const edits: SearchReplaceEdit[] = [
      {
        searchBlock: "with BuildPart() as part:\n    Box(box_width, box_width, box_height)",
        replaceBlock: "with BuildPart() as part:\n    Box(box_width, box_width, box_height)\n    fillet(part.edges(), 2)",
      },
    ];

    const result = applyEdits(sampleCode, edits);
    expect(result.success).toBe(true);
    expect(result.appliedCount).toBe(1);
    expect(result.resultCode).toContain("fillet(part.edges(), 2)");
  });

  it("succeeds partially when some edits fail", () => {
    const edits: SearchReplaceEdit[] = [
      {
        searchBlock: "box_width = 50  # mm",
        replaceBlock: "box_width = 60  # mm",
      },
      {
        searchBlock: "nonexistent line",
        replaceBlock: "something else",
      },
    ];

    const result = applyEdits(sampleCode, edits);
    expect(result.success).toBe(false); // Not fully successful
    expect(result.appliedCount).toBe(1);
    expect(result.failedSearches).toHaveLength(1);
    expect(result.resultCode).toContain("box_width = 60  # mm");
  });
});

// ── shouldUseEditMode ────────────────────────────────────────────────────────

describe("shouldUseEditMode", () => {
  it("returns false for iteration 1", () => {
    expect(
      shouldUseEditMode({
        iteration: 1,
        previousRenderSucceeded: true,
        errorCategory: RenderErrorCategory.API_MISUSE,
        consecutiveSameCategory: 0,
      }),
    ).toBe(false);
  });

  it("returns false when previous render did not succeed", () => {
    expect(
      shouldUseEditMode({
        iteration: 2,
        previousRenderSucceeded: false,
        errorCategory: RenderErrorCategory.API_MISUSE,
        consecutiveSameCategory: 0,
      }),
    ).toBe(false);
  });

  it("returns true for API_MISUSE with prior success", () => {
    expect(
      shouldUseEditMode({
        iteration: 2,
        previousRenderSucceeded: true,
        errorCategory: RenderErrorCategory.API_MISUSE,
        consecutiveSameCategory: 0,
      }),
    ).toBe(true);
  });

  it("returns true for TYPE_ERROR with prior success", () => {
    expect(
      shouldUseEditMode({
        iteration: 2,
        previousRenderSucceeded: true,
        errorCategory: RenderErrorCategory.TYPE_ERROR,
        consecutiveSameCategory: 0,
      }),
    ).toBe(true);
  });

  it("returns true for GEOMETRY with prior success", () => {
    expect(
      shouldUseEditMode({
        iteration: 3,
        previousRenderSucceeded: true,
        errorCategory: RenderErrorCategory.GEOMETRY,
        consecutiveSameCategory: 1,
      }),
    ).toBe(true);
  });

  it("returns true for SYNTAX with prior success", () => {
    expect(
      shouldUseEditMode({
        iteration: 2,
        previousRenderSucceeded: true,
        errorCategory: RenderErrorCategory.SYNTAX,
        consecutiveSameCategory: 0,
      }),
    ).toBe(true);
  });

  it("returns true for VLM-only feedback (null error category)", () => {
    expect(
      shouldUseEditMode({
        iteration: 2,
        previousRenderSucceeded: true,
        errorCategory: null,
        consecutiveSameCategory: 0,
      }),
    ).toBe(true);
  });

  it("returns false for INFRASTRUCTURE errors", () => {
    expect(
      shouldUseEditMode({
        iteration: 2,
        previousRenderSucceeded: true,
        errorCategory: RenderErrorCategory.INFRASTRUCTURE,
        consecutiveSameCategory: 0,
      }),
    ).toBe(false);
  });

  it("returns false when KERNEL_ERROR has repeated >= 2 times", () => {
    expect(
      shouldUseEditMode({
        iteration: 4,
        previousRenderSucceeded: true,
        errorCategory: RenderErrorCategory.KERNEL_ERROR,
        consecutiveSameCategory: 2,
      }),
    ).toBe(false);
  });

  it("returns true for KERNEL_ERROR with fewer than 2 consecutive", () => {
    expect(
      shouldUseEditMode({
        iteration: 3,
        previousRenderSucceeded: true,
        errorCategory: RenderErrorCategory.KERNEL_ERROR,
        consecutiveSameCategory: 1,
      }),
    ).toBe(true);
  });

  it("returns false when same non-kernel error repeated >= 3 times", () => {
    expect(
      shouldUseEditMode({
        iteration: 5,
        previousRenderSucceeded: true,
        errorCategory: RenderErrorCategory.API_MISUSE,
        consecutiveSameCategory: 3,
      }),
    ).toBe(false);
  });
});

// ── Integration: parse + apply on realistic Build123d code ───────────────────

describe("integration: parse + apply", () => {
  it("applies parsed edits to realistic Build123d code", () => {
    const code = `# Parameters
box_length = 60  # mm
box_width = 40  # mm
box_height = 15  # mm
fillet_radius = 5  # mm
hole_radius = 8  # mm

with BuildPart() as part:
    # Base box
    Box(box_length, box_width, box_height)
    # Round all vertical edges
    fillet(part.edges() | Axis.Z, fillet_radius)
    # Cut a hole through the center
    Cylinder(hole_radius, box_height, mode=Mode.SUBTRACT)

root_part = part.part`;

    const llmResponse = `The fillet radius is too large. Here is the fix:

<<<SEARCH
fillet_radius = 5  # mm
===
fillet_radius = 3  # mm
>>>SEARCH

<<<SEARCH
hole_radius = 8  # mm
===
hole_radius = 5  # mm
>>>SEARCH
`;

    const parsed = parseEditResponse(llmResponse);
    expect(parsed.edits).toHaveLength(2);

    const applied = applyEdits(code, parsed.edits);
    expect(applied.success).toBe(true);
    expect(applied.appliedCount).toBe(2);
    expect(applied.resultCode).toContain("fillet_radius = 3  # mm");
    expect(applied.resultCode).toContain("hole_radius = 5  # mm");
    // Unchanged parts preserved
    expect(applied.resultCode).toContain("box_length = 60  # mm");
    expect(applied.resultCode).toContain("Box(box_length, box_width, box_height)");
  });
});
