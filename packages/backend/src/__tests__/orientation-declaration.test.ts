/**
 * The Orientation declaration (ADR 0007, issue #138): what is up as used and
 * which feature faces −Y, or "no front". The spec generator's reply is read
 * strictly — a missing or malformed declaration is refused, never defaulted —
 * and codegen and the code reviewer are told the Model frame and the
 * declaration in one wording.
 */
import { describe, it, expect } from "vitest";
import {
  parseOrientationDeclaration, toOrientationDeclaration, modelFrameSection, ORIENTATION_DECLARATION_RULE,
} from "../services/orientation-declaration.js";
import { SPEC_SYSTEM_PROMPT } from "../prompts/spec-generation-system-prompt.js";

describe("parseOrientationDeclaration (the generator's reply)", () => {
  it("reads up and the front feature", () => {
    expect(parseOrientationDeclaration({ up: "the open top", front: "the USB-C port" }))
      .toEqual({ up: "the open top", front: "the USB-C port" });
  });

  it("reads \"none\" as no front, in any case", () => {
    expect(parseOrientationDeclaration({ up: "the flat top face", front: "none" })).toEqual({ up: "the flat top face", front: null });
    expect(parseOrientationDeclaration({ up: "the flat top face", front: " None " })).toEqual({ up: "the flat top face", front: null });
  });

  it("refuses a missing, partial or malformed declaration instead of defaulting it", () => {
    for (const bad of [undefined, null, "front is the port", [], {}, { up: "top" }, { front: "the port" },
      { up: "", front: "the port" }, { up: "top", front: "" }, { up: "top", front: null }, { up: 3, front: "the port" }]) {
      expect(parseOrientationDeclaration(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("toOrientationDeclaration (a stored declaration)", () => {
  it("loads a stored declaration, null front meaning no front", () => {
    expect(toOrientationDeclaration({ up: "the lid", front: "the display" })).toEqual({ up: "the lid", front: "the display" });
    expect(toOrientationDeclaration({ up: "the lid", front: null })).toEqual({ up: "the lid", front: null });
  });

  it("loads nothing for a row written before the declaration, or a damaged one", () => {
    expect(toOrientationDeclaration(null)).toBeNull();
    expect(toOrientationDeclaration({ front: "the display" })).toBeNull();
  });
});

describe("modelFrameSection", () => {
  it("states the Model frame: Z up as used, front −Y, right +X", () => {
    const s = modelFrameSection(null);
    expect(s).toMatch(/Z up/);
    expect(s).toContain("−Y");
    expect(s).toContain("+X");
  });

  it("states the prompt's declaration when there is one", () => {
    const s = modelFrameSection({ up: "the open top", front: "the USB-C port" });
    expect(s).toContain("the open top");
    expect(s).toContain("the USB-C port");
  });

  it("says when the object has no front", () => {
    expect(modelFrameSection({ up: "the flat top face", front: null })).toMatch(/no front/i);
  });
});

describe("the generator's rule", () => {
  it("teaches the frame and the silent-prompt front rule, ending in \"none\" — never an invented front", () => {
    expect(ORIENTATION_DECLARATION_RULE).toContain("−Y");
    expect(ORIENTATION_DECLARATION_RULE).toMatch(/ports, buttons/);
    expect(ORIENTATION_DECLARATION_RULE).toMatch(/points out/);
    expect(ORIENTATION_DECLARATION_RULE).toContain('"none"');
  });

  it("is part of the spec generator's prompt, with the field in the reply shape", () => {
    expect(SPEC_SYSTEM_PROMPT).toContain(ORIENTATION_DECLARATION_RULE);
    expect(SPEC_SYSTEM_PROMPT).toContain('"orientation": {"up": "...", "front": "...|none"}');
  });
});
