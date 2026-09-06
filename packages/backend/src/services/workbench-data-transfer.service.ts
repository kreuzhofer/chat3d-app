/**
 * Workbench Data Transfer Service — Types, Job Store & Public API
 *
 * Background job-based export and import of all workbench data
 * (categories, prompts, examples, tags, traces).
 *
 * Export logic: workbench-data-transfer-export.service.ts
 * Import logic: workbench-data-transfer-import.service.ts
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";
import { deleteBackupByFilePath } from "./backup.service.js";
import { runExport } from "./workbench-data-transfer-export.service.js";
import { runImport } from "./workbench-data-transfer-import.service.js";

const logger = createLogger("data-transfer");

// ── Types ────────────────────────────────────────────────────────────

export interface TransferJob {
  jobId: string;
  type: "export" | "import";
  status: "running" | "completed" | "failed";
  progress: { phase: string; detail?: string };
  counts: TransferCounts | null;
  filePath: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface TransferCounts {
  categories: number;
  prompts: number;
  examples: number;
  traces?: number;
  tags?: number;
}

export interface ExportCategory {
  id: string;
  rank: number;
  name: string;
  complexity: number;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface ExportPrompt {
  id: string;
  category_id: string;
  index: number;
  prompt: string;
  embedding: number[] | null;
  embedding_model: string | null;
  construction_spec: string | null;
  spec_embedding: number[] | null;
  spec_embedding_model: string | null;
  disambiguation_questions: unknown | null;
  disambiguation_status: string | null;
  spec_interpretation: string | null;
  detected_operations: string[];
  description: string | null;
  code_assertions: unknown | null;
  verification_checklist: unknown | null;
  verification_criteria: unknown | null;
  spec_raw_response: string | null;
  spec_system_prompt: string | null;
  enrichment_raw_response: string | null;
  enrichment_system_prompt: string | null;
  enrichment_user_message: string | null;
  created_at: string;
}

export interface ExportExample {
  id: string;
  prompt_id: string;
  iteration: number;
  generation_seed: number | null;
  code: string;
  render_status: string;
  render_error: string | null;
  stl_path: string | null;
  step_path: string | null;
  threemf_path: string | null;
  screenshot_front: string | null;
  screenshot_back: string | null;
  screenshot_left: string | null;
  screenshot_right: string | null;
  screenshot_top: string | null;
  screenshot_bottom: string | null;
  screenshot_ortho_45: string | null;
  screenshot_ortho_45_bottom: string | null;
  screenshot_iso: string | null;
  screenshot_iso_back: string | null;
  eval_score: number | null;
  eval_issues: unknown | null;
  eval_suggestions: unknown | null;
  eval_checklist_results: unknown | null;
  approval_status: string;
  rejection_note: string | null;
  llm_model: string | null;
  vlm_model: string | null;
  vlm_instrument_id?: string | null;
  vlm_thinking_effort?: string | null;
  vlm_raw_response: string | null;
  vlm_reasoning: string | null;
  vlm_system_prompt: string | null;
  code_review_raw_response: string | null;
  code_review_reasoning: string | null;
  code_review_system_prompt: string | null;
  agent_conversation: unknown | null;
  agent_system_prompt: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  featured: boolean;
  visual_score: number | null;
  code_eval_score: number | null;
  assertion_pass_rate: number | null;
  eval_source: string | null;
  experiment_run_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExportTrace {
  id: string;
  workbench_example_id: string;
  total_duration_ms: number | null;
  total_cost_usd: number | null;
  total_steps: number | null;
  total_llm_calls: number | null;
  final_status: string;
  pipeline_type: string;
  trace: unknown;
  created_at: string;
}

export interface ExportTag {
  id: string;
  name: string;
}

export interface ExportPromptTag {
  prompt_id: string;
  tag_id: string;
}

export interface WorkbenchExportData {
  version: number;
  exportedAt: string;
  categories: ExportCategory[];
  prompts: ExportPrompt[];
  examples: ExportExample[];
  traces?: ExportTrace[];
  tags?: ExportTag[];
  prompt_tags?: ExportPromptTag[];
}

/** All 10 screenshot angles with their DB column names and file suffixes. */
export const SCREENSHOT_ANGLES = [
  { column: "screenshotFront" as const, suffix: "front" },
  { column: "screenshotBack" as const, suffix: "back" },
  { column: "screenshotLeft" as const, suffix: "left" },
  { column: "screenshotRight" as const, suffix: "right" },
  { column: "screenshotTop" as const, suffix: "top" },
  { column: "screenshotBottom" as const, suffix: "bottom" },
  { column: "screenshotOrtho45" as const, suffix: "ortho-45" },
  { column: "screenshotOrtho45Bottom" as const, suffix: "ortho-45-bottom" },
  { column: "screenshotIso" as const, suffix: "iso" },
  { column: "screenshotIsoBack" as const, suffix: "iso-back" },
] as const;

// ── Shared helpers ──────────────────────────────────────────────────

export function getExportsDir(): string {
  return path.join(config.storage.rootDir, "workbench-exports");
}

const MODEL_EXTENSIONS = new Set(["stl", "step", "3mf"]);
const CODE_EXTENSIONS = new Set(["b123d"]);

/**
 * Remap a legacy flat workbench path to the new code/artifacts structure.
 * Paths already containing /artifacts/ or /code/ are returned unchanged.
 */
export function remapLegacyWorkbenchPath(p: string): string {
  if (!p.startsWith("workbench/")) return p;
  if (p.includes("/artifacts/") || p.includes("/code/")) return p;
  const segments = p.split("/");
  if (segments.length !== 3) return p;
  const fileName = segments[2];
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (CODE_EXTENSIONS.has(ext)) {
    return `${segments[0]}/${segments[1]}/code/${fileName}`;
  }
  if (MODEL_EXTENSIONS.has(ext) || (ext === "png" && fileName.includes("-screenshot-"))) {
    return `${segments[0]}/${segments[1]}/artifacts/${fileName}`;
  }
  return p;
}

/**
 * Strip the "files/" prefix from a ZIP-internal path to get the storage-relative path.
 * Passes through null and non-prefixed values (e.g. legacy base64).
 */
export function stripFilesPrefix(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith("files/")) return value.slice("files/".length);
  return value;
}

export function remapNullable(value: string | null): string | null {
  return value ? remapLegacyWorkbenchPath(value) : null;
}

// ── In-memory job store ──────────────────────────────────────────────

const jobs = new Map<string, TransferJob>();
let jobCounter = 0;

function generateJobId(type: "export" | "import"): string {
  jobCounter += 1;
  return `${type}-${Date.now()}-${jobCounter}`;
}

// ── Public API ───────────────────────────────────────────────────────

export function startExport(): TransferJob {
  const jobId = generateJobId("export");
  const job: TransferJob = {
    jobId,
    type: "export",
    status: "running",
    progress: { phase: "starting" },
    counts: null,
    filePath: null,
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobs.set(jobId, job);
  void runExport(job);
  return job;
}

export function startImport(uploadedFilePath: string): TransferJob {
  const jobId = generateJobId("import");
  const job: TransferJob = {
    jobId,
    type: "import",
    status: "running",
    progress: { phase: "starting" },
    counts: null,
    filePath: uploadedFilePath,
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobs.set(jobId, job);
  void runImport(job, uploadedFilePath);
  return job;
}

export function getTransferJob(jobId: string): TransferJob | null {
  return jobs.get(jobId) ?? null;
}

export function listTransferJobs(): TransferJob[] {
  return Array.from(jobs.values()).sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt),
  );
}

export async function deleteTransferJob(jobId: string): Promise<"deleted" | "not_found" | "still_running"> {
  const job = jobs.get(jobId);
  if (!job) return "not_found";
  if (job.status === "running") return "still_running";

  if (job.filePath) {
    try {
      await fs.unlink(job.filePath);
      logger.info({ jobId, filePath: job.filePath }, "deleted export file");
    } catch (err) {
      logger.debug({ jobId, err }, "export file already removed or inaccessible");
    }
    try {
      await deleteBackupByFilePath(job.filePath);
    } catch (err) {
      logger.warn({ jobId, err }, "failed to delete backup record for transfer job (non-fatal)");
    }
  }

  jobs.delete(jobId);
  logger.info({ jobId, type: job.type }, "transfer job deleted");
  return "deleted";
}

export function getExportFilePath(jobId: string): string | null {
  const job = jobs.get(jobId);
  if (!job || job.type !== "export" || job.status !== "completed" || !job.filePath) {
    return null;
  }
  return job.filePath;
}
