/**
 * Workbench Data Transfer Service
 *
 * Background job-based export and import of all workbench data
 * (categories, prompts, examples, system prompts).
 *
 * Export writes a JSON file to disk; import reads it and replaces
 * the full workbench dataset in a single transaction.
 *
 * Job pattern mirrors workbench-batch.service.ts — in-memory map
 * with polling from the frontend.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { pool } from "../db/connection.js";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";
import { readStorageFile, writeStorageFile } from "./file-storage.service.js";

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
  systemPrompts: number;
}

export interface WorkbenchExportData {
  version: number;
  exportedAt: string;
  categories: ExportCategory[];
  prompts: ExportPrompt[];
  examples: ExportExample[];
  systemPrompts: ExportSystemPrompt[];
}

interface ExportCategory {
  id: string;
  rank: number;
  name: string;
  complexity: number;
  description: string;
  created_at: string;
  updated_at: string;
}

interface ExportPrompt {
  id: string;
  category_id: string;
  index: number;
  prompt: string;
  embedding: number[] | null;
  embedding_model: string | null;
  created_at: string;
}

interface ExportExample {
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
  screenshot_top: string | null;
  screenshot_iso: string | null;
  screenshot_iso_back: string | null;
  eval_score: number | null;
  eval_issues: unknown | null;
  eval_suggestions: unknown | null;
  approval_status: string;
  rejection_note: string | null;
  llm_model: string | null;
  vlm_model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  created_at: string;
  updated_at: string;
}

interface ExportSystemPrompt {
  id: string;
  version: number;
  label: string;
  content: string;
  is_active: boolean;
  created_at: string;
}

// ── In-memory job store ──────────────────────────────────────────────

const jobs = new Map<string, TransferJob>();
let jobCounter = 0;

function generateJobId(type: "export" | "import"): string {
  jobCounter += 1;
  return `${type}-${Date.now()}-${jobCounter}`;
}

function getExportsDir(): string {
  return path.join(config.storage.rootDir, "workbench-exports");
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Start a background export job. Returns immediately with the job ID.
 */
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

  // Run in background
  void runExport(job);

  return job;
}

/**
 * Start a background import job from an uploaded file.
 */
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

  // Run in background
  void runImport(job, uploadedFilePath);

  return job;
}

/**
 * Get a transfer job by ID.
 */
export function getTransferJob(jobId: string): TransferJob | null {
  return jobs.get(jobId) ?? null;
}

/**
 * List all transfer jobs, most recent first.
 */
export function listTransferJobs(): TransferJob[] {
  return Array.from(jobs.values()).sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt),
  );
}

/**
 * Delete a completed or failed transfer job. Running jobs cannot be deleted.
 * If the job has an associated export file on disk, it is also removed.
 */
export async function deleteTransferJob(jobId: string): Promise<"deleted" | "not_found" | "still_running"> {
  const job = jobs.get(jobId);
  if (!job) return "not_found";
  if (job.status === "running") return "still_running";

  // Clean up export file if it exists
  if (job.filePath) {
    try {
      await fs.unlink(job.filePath);
      logger.info({ jobId, filePath: job.filePath }, "deleted export file");
    } catch (err) {
      // File may already be gone — log but don't fail
      logger.debug({ jobId, err }, "export file already removed or inaccessible");
    }
  }

  jobs.delete(jobId);
  logger.info({ jobId, type: job.type }, "transfer job deleted");
  return "deleted";
}

/**
 * Get the file path for a completed export job (for download).
 */
export function getExportFilePath(jobId: string): string | null {
  const job = jobs.get(jobId);
  if (!job || job.type !== "export" || job.status !== "completed" || !job.filePath) {
    return null;
  }
  return job.filePath;
}

// ── Screenshot file helpers ──────────────────────────────────────────

/**
 * Resolve a screenshot column value for export.
 * If the value is a file path (starts with "workbench/"), read the file
 * from disk and return its base64 content so the export JSON is self-contained.
 * If the value is already base64 (legacy) or null, return as-is.
 */
async function resolveScreenshotForExport(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  if (value.startsWith("workbench/")) {
    try {
      const buffer = await readStorageFile({ relativePath: value });
      return buffer.toString("base64");
    } catch (err) {
      logger.warn({ path: value, err }, "could not read screenshot file for export, skipping");
      return null;
    }
  }
  // Legacy base64 — pass through
  return value;
}

/**
 * Write a screenshot base64 string to disk during v2 import.
 * Returns the relative file path stored in the DB column.
 * If the base64 is null/empty, returns null (no file to write).
 */
async function writeScreenshotOnImport(
  categoryId: string,
  exampleId: string,
  angle: string,
  base64Value: string | null,
): Promise<string | null> {
  if (!base64Value) return null;
  const relativePath = `workbench/${categoryId}/${exampleId}-screenshot-${angle}.png`;
  try {
    await writeStorageFile({ relativePath, contentBase64: base64Value });
    return relativePath;
  } catch (err) {
    logger.warn({ relativePath, err }, "could not write screenshot file during import, storing base64 in DB");
    return base64Value;
  }
}

// ── Export logic ─────────────────────────────────────────────────────

async function runExport(job: TransferJob): Promise<void> {
  try {
    // Ensure exports directory exists
    const exportsDir = getExportsDir();
    await fs.mkdir(exportsDir, { recursive: true });

    // 1. Query categories
    job.progress = { phase: "querying categories" };
    const catResult = await pool.query(
      `SELECT id, rank, name, complexity, description,
              created_at, updated_at
       FROM workbench_categories
       ORDER BY rank ASC`,
    );
    const categories: ExportCategory[] = catResult.rows.map((r) => ({
      id: r.id,
      rank: r.rank,
      name: r.name,
      complexity: r.complexity,
      description: r.description,
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
    }));

    // 2. Query prompts (cast embedding to text for JSON serialization — pgvector can't cast to float[])
    job.progress = { phase: "querying prompts", detail: `${categories.length} categories found` };
    const promptResult = await pool.query(
      `SELECT id, category_id, index, prompt,
              embedding::text AS embedding, embedding_model,
              created_at
       FROM workbench_example_prompts
       ORDER BY category_id, index ASC`,
    );
    const prompts: ExportPrompt[] = promptResult.rows.map((r) => ({
      id: r.id,
      category_id: r.category_id,
      index: r.index,
      prompt: r.prompt,
      embedding: r.embedding ? JSON.parse(r.embedding) : null,
      embedding_model: r.embedding_model ?? null,
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }));

    // 3. Query examples (largest table)
    job.progress = { phase: "querying examples", detail: `${prompts.length} prompts found` };
    const exampleResult = await pool.query(
      `SELECT id, prompt_id, iteration, generation_seed, code,
              render_status, render_error,
              stl_path, step_path, threemf_path,
              screenshot_front, screenshot_top, screenshot_iso, screenshot_iso_back,
              eval_score, eval_issues, eval_suggestions,
              approval_status, rejection_note,
              llm_model, vlm_model, prompt_tokens, completion_tokens,
              created_at, updated_at
       FROM workbench_examples
       ORDER BY prompt_id, iteration ASC`,
    );

    // Resolve screenshot values: if they are file paths (start with "workbench/"),
    // read the file from disk and export as base64 so the export is self-contained.
    job.progress = { phase: "resolving screenshot files", detail: `${exampleResult.rows.length} examples` };
    const examples: ExportExample[] = [];
    for (const r of exampleResult.rows) {
      const ex: ExportExample = {
        id: r.id,
        prompt_id: r.prompt_id,
        iteration: r.iteration,
        generation_seed: r.generation_seed ?? null,
        code: r.code,
        render_status: r.render_status,
        render_error: r.render_error ?? null,
        stl_path: r.stl_path ?? null,
        step_path: r.step_path ?? null,
        threemf_path: r.threemf_path ?? null,
        screenshot_front: await resolveScreenshotForExport(r.screenshot_front),
        screenshot_top: await resolveScreenshotForExport(r.screenshot_top),
        screenshot_iso: await resolveScreenshotForExport(r.screenshot_iso),
        screenshot_iso_back: await resolveScreenshotForExport(r.screenshot_iso_back),
        eval_score: r.eval_score ?? null,
        eval_issues: r.eval_issues ?? null,
        eval_suggestions: r.eval_suggestions ?? null,
        approval_status: r.approval_status,
        rejection_note: r.rejection_note ?? null,
        llm_model: r.llm_model ?? null,
        vlm_model: r.vlm_model ?? null,
        prompt_tokens: r.prompt_tokens ?? null,
        completion_tokens: r.completion_tokens ?? null,
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
        updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
      };
      examples.push(ex);
    }

    // 4. Query system prompts
    job.progress = { phase: "querying system prompts", detail: `${examples.length} examples found` };
    const spResult = await pool.query(
      `SELECT id, version, label, content, is_active, created_at
       FROM workbench_system_prompts
       ORDER BY version ASC`,
    );
    const systemPrompts: ExportSystemPrompt[] = spResult.rows.map((r) => ({
      id: r.id,
      version: r.version,
      label: r.label,
      content: r.content,
      is_active: r.is_active,
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }));

    // 5. Build and write JSON
    job.progress = { phase: "writing file" };
    const exportData: WorkbenchExportData = {
      version: 2,
      exportedAt: new Date().toISOString(),
      categories,
      prompts,
      examples,
      systemPrompts,
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const fileName = `workbench-export-${timestamp}.json`;
    const filePath = path.join(exportsDir, fileName);

    await fs.writeFile(filePath, JSON.stringify(exportData), "utf-8");

    // 6. Done
    job.filePath = filePath;
    job.counts = {
      categories: categories.length,
      prompts: prompts.length,
      examples: examples.length,
      systemPrompts: systemPrompts.length,
    };
    job.status = "completed";
    job.finishedAt = new Date().toISOString();
    job.progress = { phase: "done" };

    logger.info(
      { jobId: job.jobId, categories: categories.length, prompts: prompts.length, examples: examples.length, systemPrompts: systemPrompts.length, filePath },
      "export completed",
    );
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : String(error);
    job.finishedAt = new Date().toISOString();
    logger.error({ jobId: job.jobId, err: job.error }, "export failed");
  }
}

// ── Import logic ─────────────────────────────────────────────────────

async function runImport(job: TransferJob, filePath: string): Promise<void> {
  try {
    // 1. Read and parse file
    job.progress = { phase: "reading file" };
    const raw = await fs.readFile(filePath, "utf-8");

    job.progress = { phase: "parsing JSON" };
    const data = JSON.parse(raw) as WorkbenchExportData;

    // 2. Validate structure
    if (!data.version || (data.version !== 1 && data.version !== 2)) {
      throw new Error(`Unsupported export version: ${data.version}`);
    }
    const isV2 = data.version === 2;
    if (!Array.isArray(data.categories) || !Array.isArray(data.prompts) ||
        !Array.isArray(data.examples) || !Array.isArray(data.systemPrompts)) {
      throw new Error("Invalid export file: missing required arrays");
    }

    logger.info(
      { jobId: job.jobId, categories: data.categories.length, prompts: data.prompts.length, examples: data.examples.length, systemPrompts: data.systemPrompts.length },
      "import started",
    );

    // 3. Run destructive import in a single transaction
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Delete in FK order (children first)
      job.progress = { phase: "clearing existing data" };
      await client.query("DELETE FROM workbench_examples");
      await client.query("DELETE FROM workbench_example_prompts");
      await client.query("DELETE FROM workbench_categories");
      await client.query("DELETE FROM workbench_system_prompts");

      // Insert categories
      job.progress = { phase: "inserting categories", detail: `${data.categories.length} rows` };
      for (const cat of data.categories) {
        await client.query(
          `INSERT INTO workbench_categories (id, rank, name, complexity, description, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [cat.id, cat.rank, cat.name, cat.complexity, cat.description, cat.created_at, cat.updated_at],
        );
      }

      // Insert prompts (with embeddings)
      job.progress = { phase: "inserting prompts", detail: `${data.prompts.length} rows` };
      for (const p of data.prompts) {
        const embeddingValue = p.embedding
          ? `[${p.embedding.join(",")}]`
          : null;
        await client.query(
          `INSERT INTO workbench_example_prompts (id, category_id, index, prompt, embedding, embedding_model, created_at)
           VALUES ($1, $2, $3, $4, $5::vector, $6, $7)`,
          [p.id, p.category_id, p.index, p.prompt, embeddingValue, p.embedding_model, p.created_at],
        );
      }

      // Insert examples
      // Build prompt→category lookup so we can construct file paths for v2 imports
      const promptCategoryMap = new Map<string, string>();
      for (const p of data.prompts) {
        promptCategoryMap.set(p.id, p.category_id);
      }

      job.progress = { phase: "inserting examples", detail: `${data.examples.length} rows` };
      for (const ex of data.examples) {
        // For v2 imports: write screenshot base64 to disk and store file paths in DB.
        // For v1 imports: insert base64 directly (legacy — user can run migrate:screenshots later).
        let ssFront = ex.screenshot_front;
        let ssTop = ex.screenshot_top;
        let ssIso = ex.screenshot_iso;
        let ssIsoBack = ex.screenshot_iso_back ?? null;

        if (isV2 && promptCategoryMap.has(ex.prompt_id)) {
          const categoryId = promptCategoryMap.get(ex.prompt_id)!;
          ssFront = await writeScreenshotOnImport(categoryId, ex.id, "front", ssFront);
          ssTop = await writeScreenshotOnImport(categoryId, ex.id, "top", ssTop);
          ssIso = await writeScreenshotOnImport(categoryId, ex.id, "iso", ssIso);
          ssIsoBack = await writeScreenshotOnImport(categoryId, ex.id, "iso-back", ssIsoBack);
        }

        await client.query(
          `INSERT INTO workbench_examples (
            id, prompt_id, iteration, generation_seed, code,
            render_status, render_error,
            stl_path, step_path, threemf_path,
            screenshot_front, screenshot_top, screenshot_iso, screenshot_iso_back,
            eval_score, eval_issues, eval_suggestions,
            approval_status, rejection_note,
            llm_model, vlm_model, prompt_tokens, completion_tokens,
            created_at, updated_at
           ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7,
            $8, $9, $10,
            $11, $12, $13, $14,
            $15, $16, $17,
            $18, $19,
            $20, $21, $22, $23,
            $24, $25
           )`,
          [
            ex.id, ex.prompt_id, ex.iteration, ex.generation_seed, ex.code,
            ex.render_status, ex.render_error,
            ex.stl_path, ex.step_path, ex.threemf_path,
            ssFront, ssTop, ssIso, ssIsoBack,
            ex.eval_score,
            ex.eval_issues ? JSON.stringify(ex.eval_issues) : null,
            ex.eval_suggestions ? JSON.stringify(ex.eval_suggestions) : null,
            ex.approval_status, ex.rejection_note,
            ex.llm_model, ex.vlm_model, ex.prompt_tokens, ex.completion_tokens,
            ex.created_at, ex.updated_at,
          ],
        );
      }

      // Insert system prompts
      job.progress = { phase: "inserting system prompts", detail: `${data.systemPrompts.length} rows` };
      for (const sp of data.systemPrompts) {
        await client.query(
          `INSERT INTO workbench_system_prompts (id, version, label, content, is_active, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [sp.id, sp.version, sp.label, sp.content, sp.is_active, sp.created_at],
        );
      }

      await client.query("COMMIT");
    } catch (txError) {
      await client.query("ROLLBACK");
      throw txError;
    } finally {
      client.release();
    }

    // 4. Done
    job.counts = {
      categories: data.categories.length,
      prompts: data.prompts.length,
      examples: data.examples.length,
      systemPrompts: data.systemPrompts.length,
    };
    job.status = "completed";
    job.finishedAt = new Date().toISOString();
    job.progress = { phase: "done" };

    logger.info(
      { jobId: job.jobId, categories: data.categories.length, prompts: data.prompts.length, examples: data.examples.length, systemPrompts: data.systemPrompts.length },
      "import completed",
    );

    // Clean up uploaded file
    try {
      await fs.unlink(filePath);
    } catch {
      // Non-fatal
    }
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : String(error);
    job.finishedAt = new Date().toISOString();
    logger.error({ jobId: job.jobId, err: job.error }, "import failed");
  }
}
