/**
 * Global resource semaphore registry.
 *
 * Provides bounded concurrency for shared resources (Build123d, screenshot
 * service, LLM providers). All callers — chat pipeline, workbench batch,
 * workbench single-prompt — go through the same semaphores transparently.
 */

import { config } from "../config.js";
import { AsyncSemaphore } from "./async-semaphore.js";
import { createLogger } from "./logger.js";

const logger = createLogger("resource-limits");

// ── Fixed infrastructure semaphores ──────────────────────────────────

export const build123dSemaphore = new AsyncSemaphore({
  name: "build123d",
  maxConcurrent: config.concurrency.build123dMaxConcurrent,
  queueTimeout: config.concurrency.build123dQueueTimeoutMs,
});

export const screenshotSemaphore = new AsyncSemaphore({
  name: "screenshot",
  maxConcurrent: config.concurrency.screenshotMaxConcurrent,
  queueTimeout: config.concurrency.screenshotQueueTimeoutMs,
});

// ── Per-provider LLM semaphores (created lazily) ─────────────────────

const llmSemaphores = new Map<string, AsyncSemaphore>();

/**
 * Get the LLM semaphore for a specific provider.
 *
 * Lazily creates a semaphore per provider. If the provider has a
 * `max_concurrent` value in the DB, that is used; otherwise falls back
 * to the global `LLM_MAX_CONCURRENT` env var default.
 *
 * @param providerName - The provider identifier (e.g. "openai", "ollama").
 * @param maxConcurrentOverride - Optional per-provider limit from the DB.
 *        When provided, updates the provider's semaphore limit.
 */
export function getLlmSemaphore(
  providerName: string,
  maxConcurrentOverride?: number | null,
): AsyncSemaphore {
  const limit = maxConcurrentOverride ?? config.concurrency.llmMaxConcurrent;

  let semaphore = llmSemaphores.get(providerName);
  if (!semaphore) {
    semaphore = new AsyncSemaphore({
      name: `llm-${providerName}`,
      maxConcurrent: limit,
      queueTimeout: config.concurrency.llmQueueTimeoutMs,
    });
    llmSemaphores.set(providerName, semaphore);
    logger.info(
      { provider: providerName, maxConcurrent: limit },
      "created LLM semaphore for provider",
    );
  }

  return semaphore;
}
