/**
 * Shared Experiment Execution Lock
 *
 * Ensures only one experiment (codegen or VLM comparison) runs at a time.
 */

import { createLogger } from "../utils/logger.js";

const logger = createLogger("experiment-lock");

interface RunningExperiment {
  experimentId: string;
  abortController: AbortController;
}

let runningExperiment: RunningExperiment | null = null;

export function acquireExperimentLock(experimentId: string): AbortController {
  if (runningExperiment) {
    throw new Error("Another experiment is already running");
  }
  const abortController = new AbortController();
  runningExperiment = { experimentId, abortController };
  logger.info({ experimentId }, "experiment lock acquired");
  return abortController;
}

export function releaseExperimentLock(experimentId: string): void {
  if (runningExperiment?.experimentId === experimentId) {
    runningExperiment = null;
    logger.info({ experimentId }, "experiment lock released");
  }
}

export function isExperimentRunning(): boolean {
  return runningExperiment !== null;
}

export function getRunningExperimentId(): string | null {
  return runningExperiment?.experimentId ?? null;
}

export function cancelRunningExperiment(experimentId: string): boolean {
  if (!runningExperiment || runningExperiment.experimentId !== experimentId) {
    return false;
  }
  runningExperiment.abortController.abort();
  logger.info({ experimentId }, "experiment cancellation requested");
  return true;
}
