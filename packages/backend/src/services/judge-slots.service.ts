/**
 * The judge-call queue (issue #120).
 *
 * ADR 0006's condition is one request per judge replica. Drivers used to keep
 * it by running no more rows at once than the judge has replicas — which ties
 * batch generation, where the judge is ~30 s of a ~7 min row, to the judge's
 * pool size. This queue keeps it at the call instead: before each judge call,
 * wait while this process already has as many judge calls in flight as the
 * judge's pool has serving replicas. Callers can then outnumber the replicas.
 *
 * The replica count is read from the same cached gateway snapshot the serving
 * gate and the usage stamp use (ADR 0005), and re-read on every acquire, so the
 * queue follows a pool resized under a running batch. The calls per replica
 * are a setting, 1 by default — ADR 0006's condition; above 1 is Daniel's
 * call, trading reproducibility for judge throughput. A pool the gateway does
 * not report (a hosted provider) is not capped: an unread condition is not a
 * licence to act as though it failed, as in the gate.
 */
import { readServingSnapshot } from "./serving-provenance.service.js";
import { getJudgeCallsPerReplica } from "./generation-settings.service.js";

export interface JudgeTarget {
  provider: string;
  modelName: string;
  endpointUrl: string | null | undefined;
}

/** How many judge calls may be in flight; null = unread, not capped. */
type ReadLimit = () => Promise<number | null>;

const inFlight = new Map<string, number>();
const waiting = new Map<string, Array<() => void>>();

function wake(key: string): void {
  const next = waiting.get(key)?.shift();
  if (next) next();
}

async function acquire(key: string, read: ReadLimit): Promise<void> {
  for (;;) {
    const limit = await read();
    const held = inFlight.get(key) ?? 0;
    if (limit === null || limit < 1 || held < limit) {
      inFlight.set(key, held + 1);
      return;
    }
    await new Promise<void>((resolve) => {
      const q = waiting.get(key) ?? [];
      q.push(resolve);
      waiting.set(key, q);
    });
  }
}

function release(key: string): void {
  inFlight.set(key, Math.max(0, (inFlight.get(key) ?? 1) - 1));
  wake(key);
}

/** Serving replicas × calls per replica, or null when the gateway does not report the pool. */
export async function judgeCallLimit(target: JudgeTarget): Promise<number | null> {
  const replicas = (await readServingSnapshot(target.endpointUrl, target.modelName))?.servingCount ?? null;
  return replicas === null ? null : replicas * (await getJudgeCallsPerReplica());
}

/** Run one judge call once a replica's worth of room is free. `read` is a test seam. */
export async function withJudgeSlot<T>(target: JudgeTarget, fn: () => Promise<T>, read?: ReadLimit): Promise<T> {
  const key = `${target.provider}/${target.modelName}`;
  await acquire(key, read ?? (() => judgeCallLimit(target)));
  try {
    return await fn();
  } finally {
    release(key);
  }
}
