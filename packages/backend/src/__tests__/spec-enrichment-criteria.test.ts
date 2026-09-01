// The brief asks for a test that drives a spec *through enrichment*, not just
// the normaliser: enrichment is where the shape was lost (issue #33).
import { describe, it, expect, vi, beforeEach } from "vitest";

const streamTextMock = vi.fn();
vi.mock("../services/tracked-llm.service.js", () => ({
  trackedStreamText: (opts: unknown) => streamTextMock(opts),
}));
vi.mock("../services/llm-config.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/llm-config.service.js")>()),
  getModelForPurpose: vi.fn().mockResolvedValue({
    id: "m1", provider: "p", modelName: "m", label: "p/m",
    costPer1mInput: 0, costPer1mOutput: 0, maxConcurrent: 1,
  }),
  createProviderModel: vi.fn().mockReturnValue({}),
}));

const { enrichSpec } = await import("../services/spec-enrichment.service.js");
const { deriveVisualChecklist } = await import("../utils/verification-criteria.js");

/** Enrichment streams; the service reads text-delta parts off fullStream. */
function respondWith(json: string) {
  streamTextMock.mockReturnValue({
    fullStream: (async function* () { yield { type: "text-delta", text: json }; })(),
    usage: Promise.resolve({ inputTokens: 10, outputTokens: 20 }),
    then: (r: (v: unknown) => unknown) => r({ usage: Promise.resolve({ inputTokens: 10, outputTokens: 20 }) }),
  });
}

/** Minimal package that still produces a non-empty research section. */
const RESEARCH = {
  examples: [{ prompt: "a bookend", code: "Box(1,1,1)", similarity: 0.9 }],
  knowledge: [],
  gapWarnings: [],
} as never;

const roughSpec = {
  constructionSpec: "- make a bookend",
  verificationCriteria: [
    { text: "Two plates meet at a right angle", visibility: "visual" as const },
  ],
};

describe("enrichSpec keeps criteria usable as a checklist", () => {
  beforeEach(() => streamTextMock.mockReset());

  it("turns the model's bare strings into a checklist of real questions", async () => {
    respondWith(JSON.stringify({
      constructionSpec: "- make a bookend with exact dims",
      verificationCriteria: ["Vertical plate is present", "Base plate is present"],
    }));

    const result = await enrichSpec(roughSpec as never, RESEARCH);

    // The regression: these used to arrive as bare strings and become
    // "1. undefined" once the orchestrator mapped .text over them.
    for (const c of result.verificationCriteria) {
      expect(typeof c.text).toBe("string");
      expect(c.text.length).toBeGreaterThan(0);
      expect(c.visibility).toBeDefined();
    }
    expect(deriveVisualChecklist(result.verificationCriteria, [])).toEqual([
      "Vertical plate is present",
      "Base plate is present",
    ]);
  });

  it("keeps the rough spec's annotated criteria when the model returns nothing usable", async () => {
    respondWith(JSON.stringify({ constructionSpec: "- refined", verificationCriteria: ["", "   "] }));

    const result = await enrichSpec(roughSpec as never, RESEARCH);

    expect(result.verificationCriteria).toEqual(roughSpec.verificationCriteria);
    expect(deriveVisualChecklist(result.verificationCriteria, []))
      .toEqual(["Two plates meet at a right angle"]);
  });
});
