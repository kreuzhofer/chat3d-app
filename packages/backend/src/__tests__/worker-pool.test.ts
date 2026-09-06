import { describe, it, expect } from "vitest";
import { runWithConcurrency } from "../utils/worker-pool.js";

const tick = () => new Promise<void>((r) => setTimeout(r, 5));

describe("runWithConcurrency", () => {
  it("visits every item once, never more than `concurrency` at a time", async () => {
    let inFlight = 0, peak = 0;
    const seen: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await tick();
      seen.push(item); inFlight--;
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
  });

  it("with concurrency 1 runs strictly in order", async () => {
    const seen: number[] = [];
    await runWithConcurrency([3, 1, 2], 1, async (item) => { await tick(); seen.push(item); });
    expect(seen).toEqual([3, 1, 2]);
  });

  it("stops pulling new items once aborted, letting in-flight ones finish", async () => {
    const ac = new AbortController();
    const seen: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (item) => {
      await tick(); seen.push(item);
      if (item === 2) ac.abort();
    }, ac.signal);
    expect(seen.length).toBeLessThan(6);
    expect(seen).toContain(2);
  });

  it("rejects when a worker throws", async () => {
    await expect(runWithConcurrency([1, 2], 2, async (item) => { if (item === 2) throw new Error("boom"); }))
      .rejects.toThrow("boom");
  });
});
