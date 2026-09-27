/**
 * A sitting drawn from the corpus (issue #91): the draw is reproducible from
 * its seed, leaves out the held-out set and every earlier sitting's sample,
 * and refuses a size the frame cannot fill.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock("../db/prisma.js", () => ({ prisma: { $queryRaw: (...a: unknown[]) => db.queryRaw(...a) } }));
vi.mock("../services/visual-eval-instrument-id.service.js", () => ({ currentInstrumentId: vi.fn(async () => "production@4892d8d1b160") }));
vi.mock("../services/llm-config.service.js", () => ({ getModelForPurpose: vi.fn() }));
vi.mock("../services/vlm-experiment-create.service.js", () => ({ createVlmExperiment: vi.fn() }));
vi.mock("../services/vlm-experiment-execution.service.js", () => ({ startVlmExperiment: vi.fn() }));
vi.mock("../services/vlm-experiment.service.js", () => ({ getVlmExperimentStatus: vi.fn() }));
vi.mock("../services/adjudication-sitting.service.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../services/adjudication-sitting.service.js")>();
  return { ...mod, createSitting: vi.fn() };
});
vi.mock("../services/adjudication-triage.service.js", () => ({ startTriageJob: vi.fn() }));

import { drawIds, drawSample, inFrame, seededRandom } from "../services/adjudication-draw.service.js";

const ids = Array.from({ length: 40 }, (_, i) => `ex-${String(i).padStart(2, "0")}`);

describe("drawIds", () => {
  it("is reproducible from the seed and differs across seeds", () => {
    const a = drawIds(ids, 10, 91);
    expect(drawIds(ids, 10, 91)).toEqual(a);
    expect(a).toHaveLength(10);
    expect(new Set(a).size).toBe(10);
    expect(drawIds(ids, 10, 92)).not.toEqual(a);
    expect([...a].sort()).toEqual(a);
  });
  it("draws every row when the size is the frame", () => {
    expect(drawIds(ids, 40, 7)).toEqual(ids);
  });
  it("seededRandom stays in [0, 1)", () => {
    const r = seededRandom(3);
    for (let i = 0; i < 1000; i++) { const x = r(); expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
  });
});

describe("drawSample", () => {
  beforeEach(() => {
    db.queryRaw.mockReset();
    db.queryRaw.mockResolvedValue([
      ...ids.slice(0, 30).map((id) => ({ id, heldOut: false, lastSampledAt: null, criteriaRegeneratedAt: null })),
      ...ids.slice(30).map((id) => ({ id, heldOut: false, lastSampledAt: new Date("2026-09-20"), criteriaRegeneratedAt: null })),
    ]);
  });
  it("draws only from rows outside the held-out set and earlier samples, and reports the frame", async () => {
    const d = await drawSample({ size: 5, seed: 1 });
    expect(d).toMatchObject({ instrumentId: "production@4892d8d1b160", frame: 30, excluded: 10 });
    expect(d.exampleIds).toHaveLength(5);
    for (const id of d.exampleIds) expect(ids.indexOf(id)).toBeLessThan(30);
  });
  it("refuses a size the frame cannot fill, and a bad size or seed", async () => {
    await expect(drawSample({ size: 31, seed: 1 })).rejects.toMatchObject({ statusCode: 409 });
    await expect(drawSample({ size: 0, seed: 1 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(drawSample({ size: 5, seed: -1 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(drawSample({ size: 5.5, seed: 1 })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("inFrame (#120)", () => {
  const before = new Date("2026-09-20"), regen = new Date("2026-09-26"), after = new Date("2026-09-27");
  it("admits a row never sampled", () => {
    expect(inFrame({ heldOut: false, lastSampledAt: null, criteriaRegeneratedAt: null })).toBe(true);
    expect(inFrame({ heldOut: false, lastSampledAt: null, criteriaRegeneratedAt: regen })).toBe(true);
  });
  it("re-admits a row whose criteria were regenerated after its last sample — its adjudicated questions are gone", () => {
    expect(inFrame({ heldOut: false, lastSampledAt: before, criteriaRegeneratedAt: regen })).toBe(true);
  });
  it("keeps out a row sampled under its current criteria", () => {
    expect(inFrame({ heldOut: false, lastSampledAt: before, criteriaRegeneratedAt: null })).toBe(false);
    expect(inFrame({ heldOut: false, lastSampledAt: after, criteriaRegeneratedAt: regen })).toBe(false);
  });
  it("never admits a held-out row", () => {
    expect(inFrame({ heldOut: true, lastSampledAt: null, criteriaRegeneratedAt: null })).toBe(false);
    expect(inFrame({ heldOut: true, lastSampledAt: before, criteriaRegeneratedAt: regen })).toBe(false);
  });
});
