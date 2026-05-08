import { describe, it, expect } from "vitest";
import { listFormats, getFormat } from "../services/training-export/registry.js";

describe("training-export registry", () => {
  it("listFormats returns at least one format", () => {
    const formats = listFormats();
    expect(formats.length).toBeGreaterThan(0);
    expect(formats[0]).toMatchObject({
      id: expect.any(String),
      label: expect.any(String),
      description: expect.any(String),
      filename: expect.any(String),
    });
  });

  it("getFormat returns a format by id", () => {
    const formats = listFormats();
    const first = formats[0];
    expect(getFormat(first.id)).toBe(first);
  });

  it("getFormat returns undefined for unknown id", () => {
    expect(getFormat("does-not-exist" as never)).toBeUndefined();
  });

  it("registers openai-multitask, sharegpt-codegen, alpaca-codegen", () => {
    const ids = listFormats().map((f) => f.id);
    expect(ids).toEqual(
      expect.arrayContaining(["openai-multitask", "sharegpt-codegen", "alpaca-codegen"]),
    );
  });

  it("each format has non-empty label, description, filename, and an exporter function", () => {
    for (const f of listFormats()) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.description.length).toBeGreaterThan(0);
      expect(f.filename.length).toBeGreaterThan(0);
      expect(typeof f.exporter).toBe("function");
    }
  });
});
