/**
 * The judge-call queue (#120): no more of our own judge calls in flight than
 * the judge pool has serving replicas, whatever the number of callers — so
 * generation lanes can outnumber the judge's replicas while each replica
 * still serves one request at a time (ADR 0006). An unread pool is not capped.
 */
import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ replicas: 1 as number | null, perReplica: 1 }));
vi.mock("../services/serving-provenance.service.js", () => ({ readServingSnapshot: vi.fn(async () => ({ servingCount: h.replicas })) }));
vi.mock("../services/generation-settings.service.js", () => ({ getJudgeCallsPerReplica: vi.fn(async () => h.perReplica) }));

import { judgeCallLimit, withJudgeSlot } from "../services/judge-slots.service.js";

const tick = (ms = 5) => new Promise<void>((r) => setTimeout(r, ms));
const cfg = (modelName: string) => ({ provider: "gw", modelName, endpointUrl: "http://gw/v1" });

async function run(n: number, modelName: string, read: () => Promise<number | null>) {
  let inFlight = 0, max = 0, done = 0;
  await Promise.all(Array.from({ length: n }, () => withJudgeSlot(cfg(modelName), async () => {
    inFlight++; max = Math.max(max, inFlight); await tick(); inFlight--; done++;
  }, read)));
  return { max, done };
}

describe("withJudgeSlot", () => {
  it("keeps calls in flight at the serving replica count and runs every call", async () => {
    expect(await run(9, "a", async () => 1)).toEqual({ max: 1, done: 9 });
    expect(await run(9, "b", async () => 3)).toEqual({ max: 3, done: 9 });
  });
  it("does not cap a pool it cannot read", async () => {
    expect((await run(6, "c", async () => null)).max).toBe(6);
  });
  it("follows the replica count as it changes", async () => {
    let r = 3;
    const first = run(6, "d", async () => r);
    await tick(1); r = 1;
    const { done } = await first;
    expect(done).toBe(6);
    expect(await run(4, "d", async () => r)).toEqual({ max: 1, done: 4 });
  });
  it("releases the slot when the call throws", async () => {
    await expect(withJudgeSlot(cfg("e"), async () => { throw new Error("boom"); }, async () => 1)).rejects.toThrow("boom");
    expect(await run(2, "e", async () => 1)).toEqual({ max: 1, done: 2 });
  });
});

describe("judgeCallLimit", () => {
  it("is serving replicas times the calls-per-replica setting, null when the pool is unread", async () => {
    h.replicas = 1; h.perReplica = 1;
    expect(await judgeCallLimit(cfg("x"))).toBe(1);
    h.replicas = 3; h.perReplica = 2;
    expect(await judgeCallLimit(cfg("x"))).toBe(6);
    h.replicas = null;
    expect(await judgeCallLimit(cfg("x"))).toBeNull();
  });
});
