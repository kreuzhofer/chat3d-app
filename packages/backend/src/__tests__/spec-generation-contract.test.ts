/**
 * The generator's criteria contract (ADR 0002, issue #106): atoms taken on the
 * first reply; bare strings, bundled atoms and truncated replies retried once
 * with the defect named, then surfaced as criteriaFailure — never lifted to
 * "both", never silent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const streamTextMock = vi.fn();
vi.mock("../services/tracked-llm.service.js", () => ({
  trackedStreamText: (opts: unknown) => streamTextMock(opts),
}));
vi.mock("../services/llm-config.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/llm-config.service.js")>()),
  getModelForPurpose: vi.fn().mockResolvedValue({
    id: "m1", provider: "p", modelName: "m", label: "p/m", supportsThinking: false, thinkingEffort: null,
    costPer1mInput: 0, costPer1mOutput: 0, maxConcurrent: 1,
  }),
  createProviderModel: vi.fn().mockReturnValue({}),
}));

const { generateSpec, parseSpecResponse } = await import("../services/spec-generation.service.js");

function respondInOrder(...replies: Array<{ text: string; finishReason?: string }>) {
  for (const r of replies) {
    streamTextMock.mockReturnValueOnce({
      fullStream: (async function* () { yield { type: "text-delta", text: r.text }; })(),
      then: (resolve: (v: unknown) => unknown) => resolve({
        usage: Promise.resolve({ inputTokens: 10, outputTokens: 20 }),
        finishReason: Promise.resolve(r.finishReason ?? "stop"),
      }),
    });
  }
}

const ATOMS = [
  { text: "Rectangular box with an open top", visibility: "visual", role: "structural" },
  { text: "Exactly four standoff posts inside the box", visibility: "visual", role: "feature" },
  { text: "Wall thickness is 2mm", visibility: "code", role: "feature" },
];
/** A reply; `MISSING` leaves expectedBodyCount out of the JSON entirely. */
const MISSING = Symbol("missing");
const spec = (criteria: unknown, expectedBodyCount: unknown = 1) => JSON.stringify({
  interpretation: "An open box with standoffs.", verificationChecklist: ["Is the top open?"],
  codeAssertions: [], disambiguationNeeded: false, disambiguationQuestions: [],
  semanticContext: "box", constructionSpec: "- box 90x62x30mm, open top", verificationCriteria: criteria,
  ...(expectedBodyCount === MISSING ? {} : { expectedBodyCount }),
});

describe("parseSpecResponse applies the atoms contract", () => {
  it("keeps atoms and never lifts bare strings or the checklist into criteria", () => {
    expect(parseSpecResponse(spec(ATOMS)).verificationCriteria).toEqual(ATOMS);
    const bare = parseSpecResponse(spec(["Four standoffs"]));
    expect(bare.verificationCriteria).toEqual([]);
    expect(bare.criteriaRefused).toMatchObject({ reason: "bare-string" });
    const none = parseSpecResponse(spec(undefined));
    expect(none.verificationCriteria).toEqual([]);
    expect(none.criteriaRefused).toMatchObject({ reason: "not-an-array" });
  });

  it("reads the expected body count beside the atoms (#136)", () => {
    expect(parseSpecResponse(spec(ATOMS, 2)).expectedBodyCount).toBe(2);
  });

  it("refuses a reply whose body count is missing or invalid, as it refuses bare strings", () => {
    for (const bad of [MISSING, null, 0, 1.5, "2"]) {
      const r = parseSpecResponse(spec(ATOMS, bad));
      expect(r.criteriaRefused, String(bad)).toMatchObject({ reason: "missing-body-count" });
      expect(r.verificationCriteria).toEqual([]);
      expect(r.expectedBodyCount).toBeNull();
    }
  });

  it("refuses a reply with an atom missing its role", () => {
    const r = parseSpecResponse(spec([{ text: "Open top", visibility: "visual" }]));
    expect(r.criteriaRefused).toMatchObject({ reason: "missing-role" });
    expect(r.verificationCriteria).toEqual([]);
  });

  it("marks how the reply was read", () => {
    expect(parseSpecResponse(spec(ATOMS)).parseLevel).toBe("json");
    expect(parseSpecResponse('{"interpretation": "cut off here", "constructionSpec": "- box').parseLevel).toBe("regex");
    expect(parseSpecResponse("nothing useful").parseLevel).toBe("none");
  });
});

describe("generateSpec retries a refused reply once, then surfaces it", () => {
  beforeEach(() => streamTextMock.mockReset());

  it("asks once when the first reply is atoms", async () => {
    respondInOrder({ text: spec(ATOMS) });
    const result = await generateSpec("an open-top box with four standoffs");
    expect(streamTextMock).toHaveBeenCalledTimes(1);
    expect(result.verificationCriteria).toEqual(ATOMS);
    expect(result.expectedBodyCount).toBe(1);
    expect(result.criteriaFailure).toBeUndefined();
  });

  it("retries a missing body count with the defect named", async () => {
    respondInOrder({ text: spec(ATOMS, MISSING) }, { text: spec(ATOMS, 2) });
    const result = await generateSpec("a box with a separate lid");
    expect(streamTextMock).toHaveBeenCalledTimes(2);
    const second = streamTextMock.mock.calls[1][0] as { messages: Array<{ content: string }> };
    expect(second.messages[2].content).toMatch(/expectedBodyCount/);
    expect(result.expectedBodyCount).toBe(2);
  });

  it("retries an atom without a role with the defect named", async () => {
    respondInOrder({ text: spec([{ text: "Open top", visibility: "visual" }]) }, { text: spec(ATOMS) });
    const result = await generateSpec("an open-top box");
    const second = streamTextMock.mock.calls[1][0] as { messages: Array<{ content: string }> };
    expect(second.messages[2].content).toMatch(/"structural" or "feature"/);
    expect(result.verificationCriteria).toEqual(ATOMS);
  });

  it("retries bare strings with the defect named and takes the second reply's atoms", async () => {
    respondInOrder({ text: spec(["Four standoffs", "Open top"]) }, { text: spec(ATOMS) });
    const result = await generateSpec("an open-top box with four standoffs");
    expect(streamTextMock).toHaveBeenCalledTimes(2);
    const second = streamTextMock.mock.calls[1][0] as { messages: Array<{ role: string; content: string }> };
    expect(second.messages).toHaveLength(3);
    expect(second.messages[2].content).toMatch(/bare string/);
    expect(second.messages[2].content).toContain('{"text", "visibility", "role"}');
    expect(result.verificationCriteria).toEqual(ATOMS);
    expect(result.criteriaFailure).toBeUndefined();
  });

  it("retries a reply cut off at the output cap instead of accepting a spec with no criteria", async () => {
    respondInOrder({ text: '{"interpretation": "An open box", "constructionSpec": "- box', finishReason: "length" }, { text: spec(ATOMS) });
    const result = await generateSpec("an open-top box with four standoffs");
    expect(streamTextMock).toHaveBeenCalledTimes(2);
    const second = streamTextMock.mock.calls[1][0] as { messages: Array<{ content: string }> };
    expect(second.messages[2].content).toMatch(/cut off/);
    expect(result.verificationCriteria).toEqual(ATOMS);
  });

  it("surfaces criteriaFailure with empty criteria after two refused replies — the checklist is not lifted", async () => {
    respondInOrder({ text: spec(["Four standoffs"]) }, { text: spec([{ text: "Wall 2mm thick", visibility: "visual", role: "feature" }]) });
    const result = await generateSpec("an open-top box with four standoffs");
    expect(streamTextMock).toHaveBeenCalledTimes(2);
    expect(result.verificationCriteria).toEqual([]);
    expect(result.expectedBodyCount).toBeNull();
    expect(result.criteriaFailure).toEqual({ attempts: 2, reasons: ["bare-string", "bundled"] });
    expect(result.verificationChecklist).toEqual(["Is the top open?"]);
    expect(result.constructionSpec).toContain("box");
  });
});
