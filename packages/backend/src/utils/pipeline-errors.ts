/**
 * Shared pipeline-control errors.
 *
 * Used by both chat (query.service) and workbench (workbench-codegen.service)
 * pipelines to signal cancellation cause. The pipeline AbortController is
 * aborted with one of these as the abort reason so consumers can read
 * `signal.reason` to differentiate user cancellation from timeout.
 */

export class PipelineCancelledError extends Error {
  constructor() {
    super("Pipeline cancelled by user");
    this.name = "PipelineCancelledError";
  }
}

export class PipelineTimeoutError extends Error {
  constructor(public readonly minutes: number) {
    super(`Generation timed out after ${minutes} minute${minutes === 1 ? "" : "s"}`);
    this.name = "PipelineTimeoutError";
  }
}
