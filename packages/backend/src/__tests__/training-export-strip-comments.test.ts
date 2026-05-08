import { describe, it, expect } from "vitest";
import { stripComments } from "../services/training-export/strip-comments.js";

describe("stripComments", () => {
  it("none: returns input unchanged", () => {
    const code = "# header\nx = 1  # inline\n# end\n";
    expect(stripComments(code, "none")).toBe(code);
  });

  it("smart: drops all whole-line comments, keeps inline comments", () => {
    const code = "# header\nx = 1  # inline\n    # indented\ny = 2\n";
    expect(stripComments(code, "smart")).toBe("x = 1  # inline\ny = 2\n");
  });

  it("smarter: drops only top-level whole-line comments, keeps indented", () => {
    const code = "# header\nx = 1  # inline\n    # indented\ny = 2\n";
    expect(stripComments(code, "smarter")).toBe("x = 1  # inline\n    # indented\ny = 2\n");
  });

  it("preserves # characters inside double-quoted strings", () => {
    const code = 'x = "hash # not a comment"  # but this is\n';
    expect(stripComments(code, "smart")).toBe('x = "hash # not a comment"  # but this is\n');
  });

  it("preserves # characters inside single-quoted strings", () => {
    const code = "x = 'hash # not a comment'\n";
    expect(stripComments(code, "smart")).toBe("x = 'hash # not a comment'\n");
  });

  it("preserves # inside triple-quoted strings spanning multiple lines", () => {
    const code = 'doc = """\n# this is inside a docstring\nstill inside\n"""\nx = 1\n';
    expect(stripComments(code, "smart")).toBe(code);
  });

  it("handles escaped quotes inside strings", () => {
    const code = 'x = "she said \\"hi\\""  # comment after\n';
    expect(stripComments(code, "smart")).toBe(code);
  });

  it("collapses 3+ consecutive blank lines to 2 after stripping", () => {
    const code = "# h1\n# h2\nx = 1\n\n\n\ny = 2\n";
    expect(stripComments(code, "smart")).toBe("x = 1\n\ny = 2\n");
  });

  it("returns the input unchanged when input has no comments", () => {
    const code = "x = 1\ny = 2\n";
    expect(stripComments(code, "smart")).toBe(code);
    expect(stripComments(code, "smarter")).toBe(code);
  });

  it("smarter: keeps a whole-line comment that is indented inside a with-block", () => {
    const code = "x = 1\nwith open(p) as f:\n    # explain why\n    f.read()\n";
    expect(stripComments(code, "smarter")).toBe(code);
  });

  it("smart: drops the indented whole-line comment", () => {
    const code = "x = 1\nwith open(p) as f:\n    # explain why\n    f.read()\n";
    expect(stripComments(code, "smart")).toBe("x = 1\nwith open(p) as f:\n    f.read()\n");
  });
});
