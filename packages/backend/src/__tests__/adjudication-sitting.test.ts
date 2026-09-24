/**
 * The adjudication sitting (issue #92): the disagreement set is drawn from
 * the same loaders and pairing as the screen, frozen with both judges'
 * answers, and worked item by item; a decision needs a valid letter, an
 * agreement needs a triage to agree with, and a sitting closes only when
 * every hard flip is decided.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  sittingCreate: vi.fn(), sittingFindUnique: vi.fn(), sittingUpdate: vi.fn(),
  adjFindFirst: vi.fn(), adjUpdate: vi.fn(), adjFindMany: vi.fn(),
}));
const loaders = vi.hoisted(() => ({ loadRun: vi.fn(), loadProductionRun: vi.fn() }));

// #102: the carry has its own tests; here the sitting is created without prior verdicts.
vi.mock("../services/adjudication-carry.js", () => ({ carryIntoSitting: vi.fn().mockResolvedValue(0), CARRIED_SOURCE: "carried" }));
vi.mock("../db/prisma.js", () => ({
  prisma: {
    adjudicationSitting: {
      create: (...a: unknown[]) => db.sittingCreate(...a),
      findUnique: (...a: unknown[]) => db.sittingFindUnique(...a),
      update: (...a: unknown[]) => db.sittingUpdate(...a),
    },
    adjudication: {
      findFirst: (...a: unknown[]) => db.adjFindFirst(...a),
      update: (...a: unknown[]) => db.adjUpdate(...a),
      findMany: (...a: unknown[]) => db.adjFindMany(...a),
    },
  },
}));
vi.mock("../services/qualification-screen-load.service.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../services/qualification-screen-load.service.js")>();
  return { ...mod, loadRun: (...a: unknown[]) => loaders.loadRun(...a), loadProductionRun: (...a: unknown[]) => loaders.loadProductionRun(...a) };
});

import { completeSitting, createSitting, recordAdjudication, SittingError } from "../services/adjudication-sitting.service.js";
import { RunNotPairableError, answeredInstrumentIds } from "../services/qualification-screen-load.service.js";

const ID = "production@4892d8d1b160";
function run(runId: string, label: string, rows: Array<[string, Array<{ pass: boolean | null; detail: string; question: string }>]>, instrumentId = ID) {
  return {
    runId, label, experimentId: "exp-1", wallClockMs: null, instrumentIds: [instrumentId],
    rows: rows.map(([exampleId, checklistResults]) => ({
      exampleId, checklistResults, visualScore: 7, error: null, issues: [], instrumentId, thinkingEffort: "off", durationMs: null, completionTokens: null,
    })),
  };
}
const q = (question: string, pass: boolean | null, detail: string) => ({ question, pass, detail });

beforeEach(() => {
  Object.values(db).forEach((f) => f.mockReset());
  Object.values(loaders).forEach((f) => f.mockReset());
  db.sittingCreate.mockResolvedValue({ id: "sit-1" });
  db.sittingFindUnique.mockResolvedValue({
    id: "sit-1", title: "t", completedAt: null, adjudicator: null,
    items: [],
  });
});

describe("createSitting", () => {
  it("freezes exactly the disagreeing items with both judges' answers as words", async () => {
    loaders.loadRun.mockImplementation(async (id: string) =>
      id === "cand" ? run("cand", "qwen", [["ex-a", [q("open top?", true, "flat top"), q("lip?", false, "no lip")]], ["ex-b", [q("pin?", null, "cannot tell")]]])
                    : run("ref", "sonnet", [["ex-a", [q("open top?", false, "closed"), q("lip?", false, "no lip")]], ["ex-b", [q("pin?", true, "pin visible")]]]));
    await createSitting({ candidate: { runId: "cand" }, referenceRunId: "ref" }, "user-1");
    const data = db.sittingCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ instrumentId: ID, candidateSource: "run", candidateRunId: "cand", referenceRunId: "ref", itemCount: 2, exampleCount: 2, adjudicatorId: "user-1", title: "qwen vs sonnet" });
    expect(data.items.create).toEqual([
      expect.objectContaining({ exampleId: "ex-a", itemIndex: 0, question: "open top?", refState: "fail", refDetail: "closed", candState: "pass", candDetail: "flat top", arm2State: null }),
      expect.objectContaining({ exampleId: "ex-b", itemIndex: 0, refState: "pass", candState: "uncertain", candDetail: "cannot tell" }),
    ]);
  });

  it("takes the corpus's own ratings as the candidate", async () => {
    loaders.loadProductionRun.mockResolvedValue(run("production:exp", "production rating by qwen (off)", [["ex-a", [q("open?", true, "yes")]]]));
    loaders.loadRun.mockResolvedValue(run("ref", "sonnet", [["ex-a", [q("open?", false, "no")]]]));
    await createSitting({ candidate: { productionExperimentId: "exp-1" }, referenceRunId: "ref" }, null);
    expect(loaders.loadProductionRun).toHaveBeenCalledWith("exp-1");
    expect(db.sittingCreate.mock.calls[0][0].data).toMatchObject({ candidateSource: "production", candidateRunId: null, sampleExperimentId: "exp-1" });
  });

  it("refuses a pair under two Instrument ids", async () => {
    loaders.loadRun.mockImplementation(async (id: string) =>
      id === "cand" ? run("cand", "qwen", [["ex-a", [q("open?", true, "yes")]]], "production@aaaaaaaaaaaa") : run("ref", "sonnet", [["ex-a", [q("open?", false, "no")]]]));
    await expect(createSitting({ candidate: { runId: "cand" }, referenceRunId: "ref" }, null)).rejects.toBeInstanceOf(RunNotPairableError);
    expect(db.sittingCreate).not.toHaveBeenCalled();
  });

  it("refuses a pair that disagrees on nothing", async () => {
    loaders.loadRun.mockResolvedValue(run("x", "same", [["ex-a", [q("open?", true, "yes")]]]));
    await expect(createSitting({ candidate: { runId: "cand" }, referenceRunId: "ref" }, null)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("recordAdjudication", () => {
  beforeEach(() => {
    db.adjFindFirst.mockResolvedValue({ id: "it-1", triageVerdict: "R", sitting: { completedAt: null } });
    db.adjUpdate.mockResolvedValue({ id: "it-1", decision: "R", note: "", agreedWithTriage: true, decidedAt: new Date() });
    db.adjFindMany.mockResolvedValue([{ refState: "pass", candState: "fail", decision: "R" }]);
  });

  it("writes the decision with the adjudicator and returns the sitting's tally", async () => {
    const r = await recordAdjudication("sit-1", "it-1", { decision: "R", agreedWithTriage: true }, "user-1");
    expect(db.adjUpdate.mock.calls[0][0].data).toMatchObject({ decision: "R", agreedWithTriage: true, decidedById: "user-1" });
    expect(r.tally).toMatchObject({ hard: 1, decided: 1, candFalseFail: 1 });
  });

  it("clears a decision with null and drops the adjudicator with it", async () => {
    await recordAdjudication("sit-1", "it-1", { decision: null }, "user-1");
    expect(db.adjUpdate.mock.calls[0][0].data).toMatchObject({ decision: null, agreedWithTriage: false, decidedById: null, decidedAt: null });
  });

  it("rejects a letter outside R/C/N, an agreement with a different triage, and an item of another sitting", async () => {
    await expect(recordAdjudication("sit-1", "it-1", { decision: "X" }, null)).rejects.toMatchObject({ statusCode: 400 });
    await expect(recordAdjudication("sit-1", "it-1", { decision: "C", agreedWithTriage: true }, null)).rejects.toMatchObject({ statusCode: 400 });
    db.adjFindFirst.mockResolvedValue(null);
    await expect(recordAdjudication("sit-1", "it-9", { decision: "C" }, null)).rejects.toMatchObject({ statusCode: 404 });
    expect(db.adjUpdate).not.toHaveBeenCalled();
  });

  it("refuses to change a completed sitting", async () => {
    db.adjFindFirst.mockResolvedValue({ id: "it-1", triageVerdict: null, sitting: { completedAt: new Date() } });
    await expect(recordAdjudication("sit-1", "it-1", { decision: "C" }, null)).rejects.toBeInstanceOf(SittingError);
  });
});

describe("completeSitting", () => {
  it("refuses while a hard flip is open and closes once none is", async () => {
    db.sittingFindUnique.mockResolvedValue({ id: "sit-1", items: [{ refState: "pass", candState: "fail", decision: null }] });
    await expect(completeSitting("sit-1")).rejects.toMatchObject({ statusCode: 409 });
    expect(db.sittingUpdate).not.toHaveBeenCalled();
    const decided = { id: "it-1", exampleId: "ex-a", itemIndex: 0, question: "q", refState: "pass", refDetail: "", candState: "fail", candDetail: "", arm2State: null, arm2Detail: null,
      decision: "N", note: "", agreedWithTriage: false, decidedAt: new Date(), triageVerdict: null, example: { promptRef: { prompt: "p", category: { name: "c" } } } };
    db.sittingFindUnique.mockResolvedValue({ id: "sit-1", completedAt: null, adjudicator: null, items: [decided] });
    await completeSitting("sit-1");
    expect(db.sittingUpdate.mock.calls[0][0].data.completedAt).toBeInstanceOf(Date);
  });
});

describe("answeredInstrumentIds", () => {
  it("ignores a failed evaluation's missing id, since a failed row is never paired", () => {
    const run = {
      runId: "r", label: "sonnet", rows: [
        { exampleId: "a", visualScore: 7, checklistResults: [{ question: "q", pass: true, detail: "" }], error: null, issues: [], instrumentId: ID, thinkingEffort: "off", durationMs: null, completionTokens: null },
        { exampleId: "b", visualScore: 1, checklistResults: null, error: null, issues: ["Evaluation failed: No output generated."], instrumentId: null, thinkingEffort: "off", durationMs: null, completionTokens: null },
      ],
    };
    expect(answeredInstrumentIds(run)).toEqual([ID]);
  });
});
