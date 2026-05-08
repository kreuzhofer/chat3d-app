import { describe, it, expect, vi } from "vitest";

vi.mock("../services/training-export/codegen-rows.service.js", () => ({
  fetchCodegenRows: vi.fn(),
}));

const { fetchCodegenRows } = await import("../services/training-export/codegen-rows.service.js");
const { exportShareGptCodegenJsonl } = await import("../services/training-export/sharegpt-codegen.exporter.js");

describe("exportShareGptCodegenJsonl", () => {
  it("emits one JSON line per row with conversations [system, human, gpt]", async () => {
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

    const out = await exportShareGptCodegenJsonl({});
    const lines = out.split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toEqual({
      conversations: [
        { from: "system", value: "You are a Build123d expert." },
        { from: "human", value: "Make a 20mm cube" },
        { from: "gpt", value: "```python\nfrom build123d import *\nb = Box(20, 20, 20)\n\n```" },
      ],
    });
  });

  it("returns empty string when no rows match", async () => {
    (fetchCodegenRows as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const out = await exportShareGptCodegenJsonl({});
    expect(out).toBe("");
  });

  it("emits one line per row joined by newlines", async () => {
    (fetchCodegenRows as ReturnType<typeof vi.fn>).mockResolvedValue([
      { exampleId: "1", promptId: "p1", prompt: "a", code: "x", systemPrompt: "s", category: "c", evalScore: null },
      { exampleId: "2", promptId: "p2", prompt: "b", code: "y", systemPrompt: "s", category: "c", evalScore: null },
    ]);
    const out = await exportShareGptCodegenJsonl({});
    expect(out.split("\n")).toHaveLength(2);
  });

  it("forwards minScore, categoryId, approvalOnly to fetchCodegenRows", async () => {
    (fetchCodegenRows as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await exportShareGptCodegenJsonl({ minScore: 8, categoryId: "cat-x", approvalOnly: false });
    expect(fetchCodegenRows).toHaveBeenCalledWith({ minScore: 8, categoryId: "cat-x", approvalOnly: false });
  });

  it("applies commentMode='smart' to the gpt code fence", async () => {
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
    const out = await exportShareGptCodegenJsonl({ commentMode: "smart" });
    const parsed = JSON.parse(out);
    const gpt = parsed.conversations[2].value as string;
    expect(gpt).not.toContain("# header");
    expect(gpt).toContain("x = 20");
  });
});
