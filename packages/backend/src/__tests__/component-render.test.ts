import { describe, expect, it } from "vitest";
import { wrapSubAgentCode, hasComponentFunction, stripMainBlock } from "../services/component-render.service.js";

describe("hasComponentFunction", () => {
  it("detects `def <name>() -> Part:` at the start of a line", () => {
    expect(hasComponentFunction("def body() -> Part:\n    return Box(1,1,1)", "body")).toBe(true);
  });
  it("detects without -> Part annotation", () => {
    expect(hasComponentFunction("def body():\n    return Box(1,1,1)", "body")).toBe(true);
  });
  it("returns false when the function name differs", () => {
    expect(hasComponentFunction("def lid() -> Part:\n    return Box(1,1,1)", "body")).toBe(false);
  });
  it("returns false when no function is defined", () => {
    expect(hasComponentFunction("x = 1", "body")).toBe(false);
  });
});

describe("stripMainBlock", () => {
  it("removes a trailing __main__ block", () => {
    const code = `def body():\n    return 1\n\nif __name__ == "__main__":\n    print("x")`;
    expect(stripMainBlock(code)).toBe(`def body():\n    return 1`);
  });
  it("removes a __main__ block with single quotes", () => {
    const code = `def body():\n    return 1\n\nif __name__ == '__main__':\n    print("x")`;
    expect(stripMainBlock(code)).toBe(`def body():\n    return 1`);
  });
  it("leaves code unchanged when no __main__ block", () => {
    const code = `def body():\n    return 1`;
    expect(stripMainBlock(code)).toBe(code);
  });
});

describe("wrapSubAgentCode", () => {
  it("strips existing __main__ then appends generated wrapper", () => {
    const original = `from build123d import *\n\ndef body() -> Part:\n    return Box(10, 20, 5)\n\nif __name__ == "__main__":\n    body().export_stl("wrong.stl")`;
    const wrapped = wrapSubAgentCode({
      code: original,
      componentName: "body",
      outputStlPath: "/tmp/component.stl",
      output3mfPath: "/tmp/component.3mf",
    });

    expect(wrapped).not.toContain('export_stl("wrong.stl")');
    expect(wrapped).toContain('if __name__ == "__main__"');
    expect(wrapped).toContain('body()');
    expect(wrapped).toContain('export_stl("/tmp/component.stl")');
    expect(wrapped).toContain('export_3mf("/tmp/component.3mf")');
  });

  it("throws when the expected function is not defined", () => {
    expect(() => wrapSubAgentCode({
      code: "x = 1",
      componentName: "body",
      outputStlPath: "/tmp/c.stl",
      output3mfPath: "/tmp/c.3mf",
    })).toThrow(/function `body`/);
  });

  it("appends the wrapper when source has no existing __main__", () => {
    const original = `def pin() -> Part:\n    return Cylinder(1, 5)`;
    const wrapped = wrapSubAgentCode({
      code: original,
      componentName: "pin",
      outputStlPath: "/tmp/pin.stl",
      output3mfPath: "/tmp/pin.3mf",
    });
    expect(wrapped).toContain(original);
    expect(wrapped).toContain('pin()');
  });
});
