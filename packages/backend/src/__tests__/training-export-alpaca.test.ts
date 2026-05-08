import { describe, it, expect, vi } from "vitest";

vi.mock("../services/training-export/codegen-rows.service.js", () => ({
  fetchCodegenRows: vi.fn(),
}));

const { fetchCodegenRows } = await import("../services/training-export/codegen-rows.service.js");
const { exportAlpacaCodegenJsonl } = await import("../services/training-export/alpaca-codegen.exporter.js");

describe("exportAlpacaCodegenJsonl", () => {
  it("emits {instruction, input, output} per row, with system prompt as input", async () => {
    (fetchCodegenRows as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        exampleId: "ex-1",
        promptId: "p-1",
        prompt: "Make a 20mm cube",
        code: "from build123d import *\nb = Box(20, 20, 20)\n",
        systemPrompt: "You are a Build123d expert.",
        category: "primitives",
        evalScore: 9,
      },
    ]);

    const out = await exportAlpacaCodegenJsonl({});
    const parsed = JSON.parse(out);
    expect(parsed).toEqual({
      instruction: "Make a 20mm cube",
      input: "You are a Build123d expert.",
      output: "from build123d import *\nb = Box(20, 20, 20)\n",
    });
  });

  it("returns empty string when no rows match", async () => {
    (fetchCodegenRows as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    expect(await exportAlpacaCodegenJsonl({})).toBe("");
  });

  it("emits one line per row joined by newlines", async () => {
    (fetchCodegenRows as ReturnType<typeof vi.fn>).mockResolvedValue([
      { exampleId: "1", promptId: "p1", prompt: "a", code: "x", systemPrompt: "s", category: "c", evalScore: null },
      { exampleId: "2", promptId: "p2", prompt: "b", code: "y", systemPrompt: "s", category: "c", evalScore: null },
    ]);
    expect((await exportAlpacaCodegenJsonl({})).split("\n")).toHaveLength(2);
  });

  it("applies commentMode='smart' to the output field", async () => {
    (fetchCodegenRows as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        exampleId: "ex-1",
        promptId: "p-1",
        prompt: "Make a cube",
        code: "# header\nx = 20\n",
        systemPrompt: "s",
        category: "c",
        evalScore: null,
      },
    ]);
    const out = await exportAlpacaCodegenJsonl({ commentMode: "smart" });
    const parsed = JSON.parse(out);
    expect(parsed.output).toBe("x = 20\n");
  });
});
