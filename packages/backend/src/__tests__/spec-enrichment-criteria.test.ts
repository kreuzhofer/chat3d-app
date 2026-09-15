// Drives a spec *through enrichment*, not just the parser: enrichment is where
// the shape was lost (issue #33) and where ADR 0002's contract now holds
// (issue #104): atoms in, bare strings retried once and then surfaced.
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

/** Enrichment streams; the service reads text-delta parts off fullStream. One reply per call. */
function respondInOrder(...replies: string[]) {
  for (const json of replies) {
    streamTextMock.mockReturnValueOnce({
      fullStream: (async function* () { yield { type: "text-delta", text: json }; })(),
      usage: Promise.resolve({ inputTokens: 10, outputTokens: 20 }),
      then: (r: (v: unknown) => unknown) => r({ usage: Promise.resolve({ inputTokens: 10, outputTokens: 20 }) }),
    });
  }
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

const ATOMS = [
  { text: "Vertical plate is present", visibility: "visual" },
  { text: "Base plate is present", visibility: "visual" },
  { text: "Base plate thickness is 5mm", visibility: "code" },
];

describe("enrichSpec emits atoms by contract", () => {
  beforeEach(() => streamTextMock.mockReset());

  it("takes atoms on the first reply and asks once", async () => {
    respondInOrder(JSON.stringify({ constructionSpec: "- exact dims", verificationCriteria: ATOMS }));

    const result = await enrichSpec(roughSpec as never, RESEARCH);

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    expect(result.verificationCriteria).toEqual(ATOMS);
    expect(result.criteriaFailure).toBeUndefined();
    expect(result.roughCriteria).toEqual(roughSpec.verificationCriteria);
    expect(deriveVisualChecklist(result.verificationCriteria, [])).toEqual([
      "Vertical plate is present", "Base plate is present",
    ]);
  });

  it("refuses bare strings, retries once, and takes the atoms of the second reply", async () => {
    respondInOrder(
      JSON.stringify({ constructionSpec: "- exact dims", verificationCriteria: ["Vertical plate is present"] }),
      JSON.stringify({ constructionSpec: "- exact dims", verificationCriteria: ATOMS }),
    );

    const result = await enrichSpec(roughSpec as never, RESEARCH);

    expect(streamTextMock).toHaveBeenCalledTimes(2);
    expect(result.verificationCriteria).toEqual(ATOMS);
    expect(result.criteriaFailure).toBeUndefined();
    // The retry tells the model what was wrong.
    const secondCall = streamTextMock.mock.calls[1][0] as { messages: Array<{ role: string; content: string }> };
    expect(secondCall.messages.at(-1)?.content).toMatch(/bare string/i);
  });

  it("surfaces a failure after the retry and keeps the rough spec's atoms — never lifts to both", async () => {
    respondInOrder(
      JSON.stringify({ constructionSpec: "- exact dims", verificationCriteria: ["Vertical plate is present"] }),
      JSON.stringify({ constructionSpec: "- exact dims", verificationCriteria: [{ text: "Base plate 5mm thick", visibility: "visual" }] }),
    );

    const result = await enrichSpec(roughSpec as never, RESEARCH);

    expect(streamTextMock).toHaveBeenCalledTimes(2);
    expect(result.verificationCriteria).toEqual(roughSpec.verificationCriteria);
    expect(result.criteriaFailure).toEqual({ attempts: 2, reasons: ["bare-string", "bundled"] });
    // The enriched construction spec is still used: the failure is the criteria's, not the spec's.
    expect(result.constructionSpec).toBe("- exact dims");
  });

  it("keeps the rough spec's atoms when the model returns nothing usable at all", async () => {
    respondInOrder(
      JSON.stringify({ constructionSpec: "- refined", verificationCriteria: [] }),
      JSON.stringify({ constructionSpec: "- refined", verificationCriteria: [] }),
    );

    const result = await enrichSpec(roughSpec as never, RESEARCH);

    expect(result.verificationCriteria).toEqual(roughSpec.verificationCriteria);
    expect(result.criteriaFailure).toEqual({ attempts: 2, reasons: ["empty", "empty"] });
  });
});
