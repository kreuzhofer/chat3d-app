/**
 * Batch generation in lanes (#120): `concurrency` runs up to that many prompts
 * at once, capped by the serving gate (ADR 0006 — each new row is rated by the
 * judge, so lanes never exceed its replicas); without it the batch stays one
 * prompt at a time and opens no gate.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ inFlight: 0, maxInFlight: 0, openGate: vi.fn(), admit: vi.fn(async () => {}) }));
const prompts = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, prompt: `prompt ${i}` }));

vi.mock("../db/prisma.js", () => ({
  prisma: {
    workbenchCategory: { findUnique: vi.fn(async () => ({ name: "Missing Examples" })) },
    workbenchExamplePrompt: { findMany: vi.fn(async () => prompts) },
    workbenchExample: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("../services/workbench-codegen.service.js", () => ({
  generateForPrompt: vi.fn(async (id: string) => {
    h.inFlight++; h.maxInFlight = Math.max(h.maxInFlight, h.inFlight);
    await new Promise((r) => setTimeout(r, 5));
    h.inFlight--;
    return { exampleId: `ex-${id}`, approvalStatus: "pending", evalScore: 5 };
  }),
  reRenderForExample: vi.fn(),
}));
vi.mock("../services/workbench-embeddings.service.js", () => ({ embedAndStorePrompt: vi.fn() }));
vi.mock("../services/workbench-examples.service.js", () => ({ cleanupExamplesForPrompt: vi.fn() }));
vi.mock("../services/sse.service.js", () => ({ sseService: { publish: vi.fn(), broadcast: vi.fn() } }));
vi.mock("../services/llm-config.service.js", () => ({ getModelForPurpose: vi.fn(async () => ({ endpointUrl: "http://gw", modelName: "rc0" })) }));
vi.mock("../services/serving-gate.service.js", async (orig) => ({
  ...(await orig<typeof import("../services/serving-gate.service.js")>()),
  openServingGate: (...a: unknown[]) => h.openGate(...a),
}));

import { startBatchJob, jobs } from "../services/workbench-batch.service.js";

async function finished(jobId: string) {
  for (let i = 0; i < 200 && jobs.get(jobId)!.status === "running"; i++) await new Promise((r) => setTimeout(r, 5));
  return jobs.get(jobId)!;
}

describe("startBatchJob lanes", () => {
  beforeEach(() => {
    jobs.clear(); h.inFlight = 0; h.maxInFlight = 0; h.openGate.mockReset(); h.admit.mockClear();
    h.openGate.mockImplementation(async (o: { configuredConcurrency: number }) => ({ concurrency: Math.min(o.configuredConcurrency, 3), admit: h.admit, backoffs: 0 }));
  });
  it("runs one prompt at a time and opens no gate by default", async () => {
    const job = await finished((await startBatchJob("cat", { onlyMissing: true })).jobId);
    expect(job.completed).toBe(7);
    expect(h.maxInFlight).toBe(1);
    expect(h.openGate).not.toHaveBeenCalled();
  });
  it("runs lanes up to the gate's width and admits every dispatch", async () => {
    const job = await finished((await startBatchJob("cat", { onlyMissing: true, concurrency: 6 })).jobId);
    expect(job.completed).toBe(7);
    expect(h.maxInFlight).toBe(3);
    expect(job.concurrency).toBe(3);
    expect(h.admit).toHaveBeenCalledTimes(7);
  });
});
