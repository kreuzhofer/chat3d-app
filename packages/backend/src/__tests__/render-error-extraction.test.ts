import { describe, expect, it } from "vitest";
import { extractAndClassifyLastRenderError } from "../utils/render-error-extraction.js";
import { RenderErrorCategory } from "../utils/render-errors.js";

describe("extractAndClassifyLastRenderError", () => {
  it("returns null for empty/missing conversation", () => {
    expect(extractAndClassifyLastRenderError(null)).toBeNull();
    expect(extractAndClassifyLastRenderError(undefined)).toBeNull();
    expect(extractAndClassifyLastRenderError([])).toBeNull();
  });

  it("returns null when no render tool result is present", () => {
    const convo = [
      { role: "user", content: "build a box" },
      { role: "assistant", content: "ok" },
    ];
    expect(extractAndClassifyLastRenderError(convo)).toBeNull();
  });

  it("extracts and classifies an API_MISUSE failure from validate_and_render result", () => {
    const convo = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolName: "validate_and_render",
            output: "Validation PASSED but Render FAILED.\n\nError: NameError: name 'BadName' is not defined\n\nPlease fix the code and validate again before re-rendering.",
          },
        ],
      },
    ];
    const result = extractAndClassifyLastRenderError(convo);
    expect(result?.category).toBe(RenderErrorCategory.API_MISUSE);
    expect(result?.capturedDetail).toBe("BadName");
    expect(result?.rawMessage).toContain("NameError: name 'BadName' is not defined");
  });

  it("extracts the LAST render failure when multiple are present", () => {
    const convo = [
      {
        role: "tool",
        content: [{
          type: "tool-result",
          toolName: "validate_and_render",
          output: "Render FAILED.\n\nError: TypeError: argument expected int\n\nPlease fix",
        }],
      },
      {
        role: "tool",
        content: [{
          type: "tool-result",
          toolName: "validate_and_render",
          output: "Render FAILED.\n\nError: BRep_API: command not done\n\nPlease fix",
        }],
      },
    ];
    const result = extractAndClassifyLastRenderError(convo);
    expect(result?.category).toBe(RenderErrorCategory.KERNEL_ERROR);
  });

  it("handles render_project tool name in addition to validate_and_render", () => {
    const convo = [{
      role: "tool",
      content: [{
        type: "tool-result",
        toolName: "render_project",
        output: "Render FAILED.\n\nError: ValueError: No objects to create\n\nPlease fix",
      }],
    }];
    const result = extractAndClassifyLastRenderError(convo);
    expect(result?.category).toBe(RenderErrorCategory.GEOMETRY);
  });

  it("returns null when last render tool result is a success", () => {
    const convo = [{
      role: "tool",
      content: [{
        type: "tool-result",
        toolName: "validate_and_render",
        output: "Validation PASSED.\nRender SUCCEEDED. Generated 3 file(s): out.stl, out.step, out.3mf",
      }],
    }];
    expect(extractAndClassifyLastRenderError(convo)).toBeNull();
  });

  it("returns UNKNOWN classification when raw message format is unexpected", () => {
    const convo = [{
      role: "tool",
      content: [{
        type: "tool-result",
        toolName: "validate_and_render",
        output: "Render FAILED.\n\nError: some completely unrecognized backend hiccup\n\nPlease fix",
      }],
    }];
    const result = extractAndClassifyLastRenderError(convo);
    expect(result?.category).toBe(RenderErrorCategory.UNKNOWN);
  });

  it("survives malformed conversation input (non-array, non-object)", () => {
    expect(extractAndClassifyLastRenderError("garbage")).toBeNull();
    expect(extractAndClassifyLastRenderError(42)).toBeNull();
    expect(extractAndClassifyLastRenderError({ role: "user" })).toBeNull();
  });
});
