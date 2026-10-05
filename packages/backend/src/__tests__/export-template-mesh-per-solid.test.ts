/**
 * The export templates mesh every solid as its own 3MF object (#135).
 *
 * Since build123d 0.12, Mesher.add_shape keeps a labelled or coloured
 * Compound as one mesh. bd_warehouse labels its threads, which are several
 * touching solids, so one thread mesh is not manifold and lib3mf rejects it
 * ("3mf mesh is invalid") on every threaded fastener. Passing the solids
 * restores the one-mesh-per-solid output build123d 0.10 produced.
 */
import { describe, expect, it } from "vitest";
import { wrapInTemplate } from "../utils/workbench-code-utils.js";
import { wrapSubAgentCode } from "../services/component-render.service.js";

describe("export templates mesh per solid", () => {
  it("the workbench/chat template adds root_part's solids to the Mesher", () => {
    const wrapped = wrapInTemplate("root_part = Box(1, 1, 1)", "abc");
    expect(wrapped).toContain("exporter.add_shape(root_part.solids())");
    expect(wrapped).not.toContain("exporter.add_shape(root_part)\n");
  });

  it("refuses a root_part without solids instead of writing an empty mesh", () => {
    const wrapped = wrapInTemplate("root_part = Rectangle(1, 1)", "abc");
    const guard = wrapped.indexOf("if not root_part.solids():\n    raise ValueError(");
    expect(guard).toBeGreaterThan(wrapped.indexOf("root_part = Rectangle"));
    expect(guard).toBeLessThan(wrapped.indexOf("export_step("));
  });

  it("the sub-agent component wrapper adds the component's solids to the Mesher", () => {
    const wrapped = wrapSubAgentCode({
      code: "def body() -> Part:\n    return Box(1, 1, 1)",
      componentName: "body",
      outputStlPath: "/tmp/c.stl",
      output3mfPath: "/tmp/c.3mf",
    });
    expect(wrapped).toContain("_component_exporter.add_shape(_component_result.solids())");
    expect(wrapped).toContain("if not _component_result.solids():\n    raise ValueError(");
  });
});
