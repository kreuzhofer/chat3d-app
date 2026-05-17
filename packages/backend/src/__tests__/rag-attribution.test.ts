import { describe, it, expect } from "vitest";
import { extractIdentifiers, detectUsage } from "../services/rag-attribution.service.js";

describe("extractIdentifiers", () => {
  it("captures PascalCase symbols from Build123d code", () => {
    const code = `from build123d import *
with BuildPart() as part:
    Box(10, 10, 10)
    fillet(part.edges(), 1.0)`;
    const ids = extractIdentifiers(code);
    expect(ids).toContain("BuildPart");
    expect(ids).toContain("Box");
  });

  it("captures multi-word snake_case identifiers (length>=2 segments)", () => {
    const code = `result = sweep_along_path(profile, path_line)`;
    const ids = extractIdentifiers(code);
    expect(ids).toContain("sweep_along_path");
    expect(ids).toContain("path_line");
  });

  it("filters Python and common-generic stopwords", () => {
    const code = `if value is None: return True`;
    const ids = extractIdentifiers(code);
    expect(ids).not.toContain("True");
    expect(ids).not.toContain("None");
  });

  it("caps the identifier set at 30", () => {
    const ids = extractIdentifiers(
      Array.from({ length: 100 }, (_, i) => `Class${i}`).join(" "),
    );
    expect(ids.length).toBeLessThanOrEqual(30);
  });

  it("returns an empty array for empty input", () => {
    expect(extractIdentifiers("")).toEqual([]);
  });
});

describe("detectUsage", () => {
  it("returns used=true with evidence when an identifier appears in the final code", () => {
    const result = detectUsage(
      ["RadiusArc", "BuildLine"],
      "with BuildLine() as line: RadiusArc((0,0),(5,5), 3)",
      "",
      "draw an arc",
      "spec: arc geometry",
    );
    expect(result.used).toBe(true);
    expect(["RadiusArc", "BuildLine"]).toContain(result.evidence);
  });

  it("returns used=false when no identifier appears anywhere", () => {
    const result = detectUsage(
      ["RadiusArc"],
      "with BuildLine() as line: line.line((0,0),(5,5))",
      "",
      "draw a polyline",
      "spec: polyline geometry",
    );
    expect(result.used).toBe(false);
    expect(result.evidence).toBeNull();
  });

  it("does not credit identifiers that also appear in the user prompt (ambiguous)", () => {
    const result = detectUsage(
      ["Box"],
      "Box(10,10,10)",
      "",
      "create a Box",
      "spec",
    );
    expect(result.used).toBe(false);
  });

  it("matches against tool-call args / conversation in addition to final code", () => {
    const result = detectUsage(
      ["LoftToProfile"],
      "result = something_else()",
      "tool_args: {\"topic\": \"LoftToProfile\"}",
      "make a loft",
      "spec: loft",
    );
    expect(result.used).toBe(true);
    expect(result.evidence).toBe("LoftToProfile");
  });

  it("requires word-boundary match (no substrings)", () => {
    const result = detectUsage(
      ["Arc"],
      "ArchedRoof()",
      "",
      "build a roof",
      "spec",
    );
    expect(result.used).toBe(false);
  });
});
