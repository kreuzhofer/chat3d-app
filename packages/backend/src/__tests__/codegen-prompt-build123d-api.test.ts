/**
 * The codegen prompts teach build123d 0.13's API (#135).
 *
 * build123d 0.12 removed or renamed APIs the prompts used to show, and 0.11
 * changed Polygon's default alignment. A prompt that teaches them makes the
 * codegen model write code that fails, or lands elsewhere, on the service.
 */
import { describe, expect, it } from "vitest";
import { CODEGEN_SYSTEM_PROMPT } from "../prompts/system-prompts.js";
import { CODEGEN_SECTION_GRIDFINITY } from "../prompts/gridfinity-prompts.js";
import {
  buildFullAgentSystemPrompt,
  buildSubAgentSystemPrompt,
} from "../prompts/agent-system-prompt.js";

const PROMPTS: Record<string, string> = {
  codegen: CODEGEN_SYSTEM_PROMPT,
  gridfinity: CODEGEN_SECTION_GRIDFINITY,
  agent: buildFullAgentSystemPrompt({ isModification: false }),
  subAgent: buildSubAgentSystemPrompt({
    componentName: "bracket",
    componentDescription: "an L bracket",
    overallContext: "a shelf",
  }),
};

/** APIs gone in 0.12 (or renamed with a deprecated wrapper) → what replaced them. */
const REMOVED: Array<[RegExp, string]> = [
  [/(?<![.\w])add\(/, "insert()"],
  [/\bend_angle\b/, "arc_size"],
  [/\bangular_direction\b/, "arc_size"],
  [/\.to_tuple\(/, "tuple(v) / v.X, v.Y, v.Z"],
  [/\bmake_plane\(/, "Face(Plane)"],
  [/\bis_planar_face\b/, "Face.is_planar"],
  [/\b(ArcArcTangentArc|ArcArcTangentLine|PointArcTangentArc|PointArcTangentLine)\b/, "ConstrainedArcs / ConstrainedLines"],
  [/\.to_axis\(|\.to_wire\(|\.relocate\(/, "(removed)"],
  [/\bnew_edges\b/, "edges(Select.NEW)"],
  [/\.is_inside\(/, "BoundBox.within()"],
];

describe("codegen prompts teach build123d 0.13", () => {
  for (const [name, text] of Object.entries(PROMPTS)) {
    for (const [pattern, replacement] of REMOVED) {
      it(`${name}: no ${pattern.source} (use ${replacement})`, () => {
        const hits = text.split("\n").filter((line) => pattern.test(line));
        expect(hits).toEqual([]);
      });
    }
  }

  it("passes EllipticalCenterArc's arc_size by keyword (keyword-only since 0.12)", () => {
    const line = CODEGEN_SYSTEM_PROMPT.split("\n").find((l) => l.includes("`EllipticalCenterArc("));
    expect(line).toMatch(/EllipticalCenterArc\([^)]*arc_size=/);
  });

  it("says Polygon places its points where given (no longer centered since 0.11)", () => {
    const line = CODEGEN_SYSTEM_PROMPT.split("\n").find((l) => l.includes("`Polygon("));
    expect(line).toMatch(/Align\.NONE|not centered|as given/);
  });
});
