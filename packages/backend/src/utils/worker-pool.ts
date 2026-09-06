/**
 * Run `fn` over `items` with at most `concurrency` in flight, preserving
 * nothing about order: workers pull the next index as they finish. Stops
 * pulling new items once `signal` aborts; in-flight items complete. Errors
 * are the worker's to handle — a throwing `fn` rejects the pool.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const width = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  let next = 0;
  const worker = async (): Promise<void> => {
    while (!signal?.aborted) {
      const index = next++;
      if (index >= items.length) return;
      await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
}
