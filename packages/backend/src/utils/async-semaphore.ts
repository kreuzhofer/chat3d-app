/**
 * Async Semaphore — bounded concurrency with in-memory queuing.
 *
 * Limits the number of concurrent operations on a shared resource.
 * When all slots are occupied, callers queue with a configurable timeout.
 */

import { createLogger } from "./logger.js";

const logger = createLogger("semaphore");

export interface SemaphoreOptions {
  /** Human-readable name for logging (e.g. "build123d", "llm-openai"). */
  name: string;
  /** Maximum number of concurrent operations. */
  maxConcurrent: number;
  /** Maximum time (ms) to wait in queue before rejecting. 0 = no timeout. */
  queueTimeout: number;
}

export class QueueTimeoutError extends Error {
  constructor(
    public readonly semaphoreName: string,
    public readonly queueTimeoutMs: number,
  ) {
    super(`Queue timeout on "${semaphoreName}" after ${queueTimeoutMs}ms`);
    this.name = "QueueTimeoutError";
  }
}

interface QueueEntry {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
  onPositionChange?: (position: number, total: number) => void;
}

export class AsyncSemaphore {
  private readonly _name: string;
  private readonly _maxConcurrent: number;
  private readonly _queueTimeout: number;
  private _active = 0;
  private readonly _queue: QueueEntry[] = [];

  constructor(options: SemaphoreOptions) {
    this._name = options.name;
    this._maxConcurrent = options.maxConcurrent;
    this._queueTimeout = options.queueTimeout;
  }

  get name(): string {
    return this._name;
  }

  /** Number of currently executing operations. */
  get active(): number {
    return this._active;
  }

  /** Number of operations waiting in the queue. */
  get queued(): number {
    return this._queue.length;
  }

  /**
   * Run `fn` within a concurrency slot. If all slots are occupied, the call
   * queues until a slot frees up or the queue timeout expires.
   *
   * @param fn  The async operation to run.
   * @param opts.onQueuePositionChange  Optional callback invoked when the
   *        caller's queue position changes (e.g. a preceding item completes).
   */
  async run<T>(
    fn: () => Promise<T>,
    opts?: { onQueuePositionChange?: (position: number, total: number) => void },
  ): Promise<T> {
    await this._acquire(opts?.onQueuePositionChange);
    try {
      return await fn();
    } finally {
      this._release();
    }
  }

  // ── Internal ───────────────────────────────────────────────────────

  private _acquire(onPositionChange?: (position: number, total: number) => void): Promise<void> {
    if (this._active < this._maxConcurrent) {
      this._active++;
      logger.debug(
        { semaphore: this._name, active: this._active, queued: this._queue.length },
        "slot acquired immediately",
      );
      return Promise.resolve();
    }

    // All slots occupied — queue the caller
    return new Promise<void>((resolve, reject) => {
      const entry: QueueEntry = {
        resolve,
        reject,
        timer: null,
        onPositionChange,
      };

      if (this._queueTimeout > 0) {
        entry.timer = setTimeout(() => {
          // Remove from queue
          const idx = this._queue.indexOf(entry);
          if (idx !== -1) {
            this._queue.splice(idx, 1);
            this._notifyPositionChanges();
          }
          logger.warn(
            { semaphore: this._name, queueTimeoutMs: this._queueTimeout, queued: this._queue.length },
            "queue timeout exceeded",
          );
          reject(new QueueTimeoutError(this._name, this._queueTimeout));
        }, this._queueTimeout);
      }

      this._queue.push(entry);

      const position = this._queue.length;
      logger.debug(
        { semaphore: this._name, position, total: this._queue.length, active: this._active },
        "queued — waiting for slot",
      );

      // Notify the caller of their initial position
      if (onPositionChange) {
        onPositionChange(position, this._queue.length);
      }
    });
  }

  private _release(): void {
    if (this._queue.length > 0) {
      // Hand the slot to the next waiter
      const next = this._queue.shift()!;
      if (next.timer) clearTimeout(next.timer);

      logger.debug(
        { semaphore: this._name, active: this._active, queued: this._queue.length },
        "slot handed to next waiter",
      );

      // Notify remaining waiters of their updated positions
      this._notifyPositionChanges();

      next.resolve();
    } else {
      this._active--;
      logger.debug(
        { semaphore: this._name, active: this._active, queued: this._queue.length },
        "slot released",
      );
    }
  }

  /** Notify all queued waiters of their current position. */
  private _notifyPositionChanges(): void {
    for (let i = 0; i < this._queue.length; i++) {
      const entry = this._queue[i];
      if (entry.onPositionChange) {
        try {
          entry.onPositionChange(i + 1, this._queue.length);
        } catch {
          // Callback errors are non-fatal
        }
      }
    }
  }
}
