/**
 * Workbench Data Transfer Service
 *
 * Background job-based export and import of all workbench data
 * (categories, prompts, examples, system prompts).
 *
 * v3 exports produce a ZIP containing manifest.json + all model/screenshot files.
 * v1/v2 JSON imports are still supported for backwards compatibility.
 *
 * Job pattern mirrors workbench-batch.service.ts — in-memory map
 * with polling from the frontend.
 */

import { promises as fs } from "node:fs";
import { createWriteStream } from "node:fs";
import path from "node:path";
import archiver from "archiver";
import { Open as unzipperOpen } from "unzipper";
import { prisma } from "../db/prisma.js";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";
import {
  deleteStorageDirectory,
  getStorageAbsolutePath,
  readStorageFile,
  storageFileExists,
  writeStorageFile,
  writeStorageFileFromBuffer,
} from "./file-storage.service.js";
import { createBackup, deleteBackupByFilePath } from "./backup.service.js";

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
}

export interface WorkbenchExportData {
  version: number;
  exportedAt: string;
  categories: ExportCategory[];
  prompts: ExportPrompt[];
  examples: ExportExample[];
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
  approval_status: string;
  rejection_note: string | null;
  llm_model: string | null;
  vlm_model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  created_at: string;
  updated_at: string;
}

/** All 10 screenshot angles with their DB column names and file suffixes. */
const SCREENSHOT_ANGLES = [
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

  // Clean up export file and corresponding backup record if they exist
  if (job.filePath) {
    try {
      await fs.unlink(job.filePath);
      logger.info({ jobId, filePath: job.filePath }, "deleted export file");
    } catch (err) {
      // File may already be gone — log but don't fail
      logger.debug({ jobId, err }, "export file already removed or inaccessible");
    }

    // Remove the corresponding backup record (non-fatal)
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
 * Resolve a screenshot column value for v2 JSON export (base64 embedded).
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
 * Write a screenshot base64 string to disk during v2 JSON import.
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

// ── Export logic (ZIP — version 3) ───────────────────────────────────

async function runExport(job: TransferJob): Promise<void> {
  try {
    // Ensure exports directory exists
    const exportsDir = getExportsDir();
    await fs.mkdir(exportsDir, { recursive: true });

    // 1. Query categories
    job.progress = { phase: "querying categories" };
    const catRows = await prisma.workbenchCategory.findMany({
      orderBy: { rank: "asc" },
    });
    const categories: ExportCategory[] = catRows.map((r) => ({
      id: r.id,
      rank: r.rank,
      name: r.name,
      complexity: r.complexity,
      description: r.description,
      created_at: r.createdAt.toISOString(),
      updated_at: r.updatedAt.toISOString(),
    }));

    // 2. Query prompts (embedding needs raw SQL — pgvector cast to text)
    job.progress = { phase: "querying prompts", detail: `${categories.length} categories found` };
    const promptRows = await prisma.$queryRaw<{
      id: string;
      category_id: string;
      index: number;
      prompt: string;
      embedding: string | null;
      embedding_model: string | null;
      created_at: Date;
    }[]>`
      SELECT id, category_id, index, prompt,
              embedding::text AS embedding, embedding_model,
              created_at
       FROM workbench_example_prompts
       ORDER BY category_id, index ASC
    `;
    const prompts: ExportPrompt[] = promptRows.map((r) => ({
      id: r.id,
      category_id: r.category_id,
      index: r.index,
      prompt: r.prompt,
      embedding: r.embedding ? JSON.parse(r.embedding) : null,
      embedding_model: r.embedding_model ?? null,
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }));

    // Build prompt→category lookup for file path construction
    const promptCategoryMap = new Map<string, string>();
    for (const p of prompts) {
      promptCategoryMap.set(p.id, p.category_id);
    }

    // 3. Query examples (largest table)
    job.progress = { phase: "querying examples", detail: `${prompts.length} prompts found` };
    const exampleRows = await prisma.workbenchExample.findMany({
      orderBy: [{ promptId: "asc" }, { iteration: "asc" }],
    });

    // Build examples for manifest (file paths reference ZIP-internal paths)
    job.progress = { phase: "building manifest", detail: `${exampleRows.length} examples` };
    const examples: ExportExample[] = [];
    /** Collect files to add to ZIP: { zipPath, storageRelativePath } */
    const filesToArchive: Array<{ zipPath: string; storagePath: string }> = [];

    for (const r of exampleRows) {
      const categoryId = promptCategoryMap.get(r.promptId);
      const filePrefix = categoryId ? `files/workbench/${categoryId}/${r.id}` : null;

      // Collect model files
      const modelPaths: Array<{ dbPath: string | null; ext: string }> = [
        { dbPath: r.stlPath, ext: "stl" },
        { dbPath: r.stepPath, ext: "step" },
        { dbPath: r.threemfPath, ext: "3mf" },
      ];

      // Also include b123d source file if it exists
      if (categoryId) {
        const b123dRelPath = `workbench/${categoryId}/${r.id}.b123d`;
        if (await storageFileExists(b123dRelPath)) {
          filesToArchive.push({
            zipPath: `files/${b123dRelPath}`,
            storagePath: b123dRelPath,
          });
        }
      }

      for (const { dbPath, ext } of modelPaths) {
        if (dbPath && filePrefix) {
          // Check if the file exists on disk
          if (await storageFileExists(dbPath)) {
            filesToArchive.push({
              zipPath: `files/${dbPath}`,
              storagePath: dbPath,
            });
          }
        }
      }

      // Collect screenshot files — build manifest paths referencing ZIP-internal locations
      const screenshotManifest: Record<string, string | null> = {};
      for (const angle of SCREENSHOT_ANGLES) {
        const dbValue = r[angle.column] as string | null | undefined;
        if (dbValue && dbValue.startsWith("workbench/") && filePrefix) {
          if (await storageFileExists(dbValue)) {
            filesToArchive.push({
              zipPath: `files/${dbValue}`,
              storagePath: dbValue,
            });
            screenshotManifest[angle.suffix] = `files/${dbValue}`;
          } else {
            screenshotManifest[angle.suffix] = null;
          }
        } else if (dbValue && !dbValue.startsWith("workbench/")) {
          // Legacy base64 — include as base64 in manifest
          screenshotManifest[angle.suffix] = dbValue;
        } else {
          screenshotManifest[angle.suffix] = null;
        }
      }

      const ex: ExportExample = {
        id: r.id,
        prompt_id: r.promptId,
        iteration: r.iteration,
        generation_seed: r.generationSeed ?? null,
        code: r.code,
        render_status: r.renderStatus,
        render_error: r.renderError ?? null,
        stl_path: r.stlPath ?? null,
        step_path: r.stepPath ?? null,
        threemf_path: r.threemfPath ?? null,
        screenshot_front: screenshotManifest["front"] ?? null,
        screenshot_back: screenshotManifest["back"] ?? null,
        screenshot_left: screenshotManifest["left"] ?? null,
        screenshot_right: screenshotManifest["right"] ?? null,
        screenshot_top: screenshotManifest["top"] ?? null,
        screenshot_bottom: screenshotManifest["bottom"] ?? null,
        screenshot_ortho_45: screenshotManifest["ortho-45"] ?? null,
        screenshot_ortho_45_bottom: screenshotManifest["ortho-45-bottom"] ?? null,
        screenshot_iso: screenshotManifest["iso"] ?? null,
        screenshot_iso_back: screenshotManifest["iso-back"] ?? null,
        eval_score: r.evalScore ?? null,
        eval_issues: r.evalIssues ?? null,
        eval_suggestions: r.evalSuggestions ?? null,
        approval_status: r.approvalStatus,
        rejection_note: r.rejectionNote ?? null,
        llm_model: r.llmModel ?? null,
        vlm_model: r.vlmModel ?? null,
        prompt_tokens: r.promptTokens ?? null,
        completion_tokens: r.completionTokens ?? null,
        created_at: r.createdAt.toISOString(),
        updated_at: r.updatedAt.toISOString(),
      };
      examples.push(ex);
    }

    // 4. Build manifest and write ZIP
    job.progress = { phase: "writing ZIP", detail: `${filesToArchive.length} files to archive` };
    const manifest: WorkbenchExportData = {
      version: 3,
      exportedAt: new Date().toISOString(),
      categories,
      prompts,
      examples,
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const fileName = `workbench-export-${timestamp}.zip`;
    const filePath = path.join(exportsDir, fileName);

    await writeZipExport(filePath, manifest, filesToArchive, job);

    // 5. Done
    job.filePath = filePath;
    job.counts = {
      categories: categories.length,
      prompts: prompts.length,
      examples: examples.length,
    };
    job.status = "completed";
    job.finishedAt = new Date().toISOString();
    job.progress = { phase: "done" };

    logger.info(
      { jobId: job.jobId, categories: categories.length, prompts: prompts.length, examples: examples.length, files: filesToArchive.length, filePath },
      "ZIP export completed",
    );

    // 6. Create persistent backup record (non-fatal if it fails)
    try {
      const fileStat = await fs.stat(filePath);
      await createBackup({
        type: "workbench",
        label: `Workbench Export ${timestamp}`,
        fileName,
        filePath,
        sizeBytes: BigInt(fileStat.size),
        counts: job.counts ?? undefined,
        completedAt: new Date(),
      });
    } catch (backupErr) {
      logger.warn({ jobId: job.jobId, err: backupErr }, "failed to create backup record (non-fatal)");
    }
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : String(error);
    job.finishedAt = new Date().toISOString();
    logger.error({ jobId: job.jobId, err: job.error }, "export failed");
  }
}

/**
 * Create a ZIP file with manifest.json and all referenced files streamed from disk.
 */
async function writeZipExport(
  filePath: string,
  manifest: WorkbenchExportData,
  files: Array<{ zipPath: string; storagePath: string }>,
  job: TransferJob,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const writeStream = createWriteStream(filePath);
    const archive = archiver("zip", { zlib: { level: 6 } });

    writeStream.on("close", () => resolve());
    archive.on("error", (err: Error) => reject(err));
    archive.on("warning", (err: Error) => {
      logger.warn({ err }, "archiver warning");
    });

    archive.pipe(writeStream);

    // Add manifest.json
    archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });

    // Add files from storage — deduplicate by zipPath
    const added = new Set<string>();
    let fileCount = 0;
    for (const { zipPath, storagePath } of files) {
      if (added.has(zipPath)) continue;
      added.add(zipPath);
      try {
        const absPath = getStorageAbsolutePath(storagePath);
        archive.file(absPath, { name: zipPath });
        fileCount++;
        if (fileCount % 100 === 0) {
          job.progress = { phase: "writing ZIP", detail: `${fileCount} / ${files.length} files added` };
        }
      } catch (err) {
        logger.warn({ storagePath, err }, "could not add file to ZIP, skipping");
      }
    }

    void archive.finalize();
  });
}

// ── Import logic ─────────────────────────────────────────────────────

async function runImport(job: TransferJob, filePath: string): Promise<void> {
  try {
    // Detect format: ZIP (PK magic bytes) or JSON
    job.progress = { phase: "detecting format" };
    const header = Buffer.alloc(2);
    const fd = await fs.open(filePath, "r");
    try {
      await fd.read(header, 0, 2, 0);
    } finally {
      await fd.close();
    }

    const isZip = header[0] === 0x50 && header[1] === 0x4B; // "PK"

    if (isZip) {
      await runZipImport(job, filePath);
    } else {
      await runJsonImport(job, filePath);
    }

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

// ── ZIP Import (v3) ──────────────────────────────────────────────────

async function runZipImport(job: TransferJob, filePath: string): Promise<void> {
  // 1. Open ZIP and read manifest
  job.progress = { phase: "reading ZIP manifest" };
  const directory = await unzipperOpen.file(filePath);

  const manifestEntry = directory.files.find((f) => f.path === "manifest.json");
  if (!manifestEntry) {
    throw new Error("ZIP file does not contain manifest.json");
  }

  const manifestBuffer = await manifestEntry.buffer();
  const data = JSON.parse(manifestBuffer.toString("utf-8")) as WorkbenchExportData;

  if (data.version !== 3) {
    throw new Error(`Unexpected manifest version in ZIP: ${data.version} (expected 3)`);
  }
  if (!Array.isArray(data.categories) || !Array.isArray(data.prompts) ||
      !Array.isArray(data.examples)) {
    throw new Error("Invalid manifest: missing required arrays");
  }

  logger.info(
    { jobId: job.jobId, categories: data.categories.length, prompts: data.prompts.length, examples: data.examples.length },
    "ZIP import started",
  );

  // 2. Clean existing workbench files, then extract from ZIP
  job.progress = { phase: "cleaning old files" };
  await deleteStorageDirectory({ relativePath: "workbench" });
  logger.info({ jobId: job.jobId }, "deleted existing workbench/ directory before import");

  const fileEntries = directory.files.filter((f) => f.path.startsWith("files/") && f.type === "File");
  job.progress = { phase: "extracting files", detail: `${fileEntries.length} files` };

  let extractedCount = 0;
  for (const entry of fileEntries) {
    // Strip "files/" prefix to get the storage-relative path
    const relativePath = entry.path.slice("files/".length);
    if (!relativePath) continue;

    const buffer = await entry.buffer();
    await writeStorageFileFromBuffer({ relativePath, content: buffer });
    extractedCount++;

    if (extractedCount % 50 === 0) {
      job.progress = { phase: "extracting files", detail: `${extractedCount} / ${fileEntries.length}` };
    }
  }

  logger.info({ jobId: job.jobId, extractedCount }, "ZIP files extracted to storage");

  // 3. Build lookups
  const promptCategoryMap = new Map<string, string>();
  for (const p of data.prompts) {
    promptCategoryMap.set(p.id, p.category_id);
  }

  // 4. Run destructive import in a single transaction
  await prisma.$transaction(async (tx) => {
    // Delete in FK order (children first)
    job.progress = { phase: "clearing existing data" };
    await tx.workbenchExample.deleteMany();
    await tx.workbenchExamplePrompt.deleteMany();
    await tx.workbenchCategory.deleteMany();

    // Insert categories
    job.progress = { phase: "inserting categories", detail: `${data.categories.length} rows` };
    for (const cat of data.categories) {
      await tx.workbenchCategory.create({
        data: {
          id: cat.id,
          rank: cat.rank,
          name: cat.name,
          complexity: cat.complexity,
          description: cat.description,
          createdAt: new Date(cat.created_at),
          updatedAt: new Date(cat.updated_at),
        },
      });
    }

    // Insert prompts (with embeddings — pgvector requires raw SQL)
    job.progress = { phase: "inserting prompts", detail: `${data.prompts.length} rows` };
    for (const p of data.prompts) {
      const embeddingValue = p.embedding
        ? `[${p.embedding.join(",")}]`
        : null;
      if (embeddingValue) {
        await tx.$executeRaw`
          INSERT INTO workbench_example_prompts (id, category_id, index, prompt, embedding, embedding_model, created_at)
          VALUES (${p.id}::uuid, ${p.category_id}::uuid, ${p.index}, ${p.prompt}, ${embeddingValue}::vector, ${p.embedding_model}, ${new Date(p.created_at)})
        `;
      } else {
        await tx.workbenchExamplePrompt.create({
          data: {
            id: p.id,
            categoryId: p.category_id,
            index: p.index,
            prompt: p.prompt,
            embeddingModel: p.embedding_model,
            createdAt: new Date(p.created_at),
          },
        });
      }
    }

    // Insert examples — map ZIP-internal "files/workbench/..." paths back to "workbench/..."
    job.progress = { phase: "inserting examples", detail: `${data.examples.length} rows` };
    for (const ex of data.examples) {
      await tx.workbenchExample.create({
        data: {
          id: ex.id,
          promptId: ex.prompt_id,
          iteration: ex.iteration,
          generationSeed: ex.generation_seed,
          code: ex.code,
          renderStatus: ex.render_status,
          renderError: ex.render_error,
          stlPath: ex.stl_path,
          stepPath: ex.step_path,
          threemfPath: ex.threemf_path,
          screenshotFront: stripFilesPrefix(ex.screenshot_front),
          screenshotBack: stripFilesPrefix(ex.screenshot_back),
          screenshotLeft: stripFilesPrefix(ex.screenshot_left),
          screenshotRight: stripFilesPrefix(ex.screenshot_right),
          screenshotTop: stripFilesPrefix(ex.screenshot_top),
          screenshotBottom: stripFilesPrefix(ex.screenshot_bottom),
          screenshotOrtho45: stripFilesPrefix(ex.screenshot_ortho_45),
          screenshotOrtho45Bottom: stripFilesPrefix(ex.screenshot_ortho_45_bottom),
          screenshotIso: stripFilesPrefix(ex.screenshot_iso),
          screenshotIsoBack: stripFilesPrefix(ex.screenshot_iso_back),
          evalScore: ex.eval_score,
          evalIssues: ex.eval_issues ? ex.eval_issues as object : undefined,
          evalSuggestions: ex.eval_suggestions ? ex.eval_suggestions as object : undefined,
          approvalStatus: ex.approval_status,
          rejectionNote: ex.rejection_note,
          llmModel: ex.llm_model,
          vlmModel: ex.vlm_model,
          promptTokens: ex.prompt_tokens,
          completionTokens: ex.completion_tokens,
          createdAt: new Date(ex.created_at),
          updatedAt: new Date(ex.updated_at),
        },
      });
    }
  }, { timeout: 120000 });

  // 5. Done
  job.counts = {
    categories: data.categories.length,
    prompts: data.prompts.length,
    examples: data.examples.length,
  };
  job.status = "completed";
  job.finishedAt = new Date().toISOString();
  job.progress = { phase: "done" };

  logger.info(
    { jobId: job.jobId, categories: data.categories.length, prompts: data.prompts.length, examples: data.examples.length, files: extractedCount },
    "ZIP import completed",
  );
}

/**
 * Strip the "files/" prefix from a ZIP-internal path to get the storage-relative path.
 * Passes through null and non-prefixed values (e.g. legacy base64).
 */
function stripFilesPrefix(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith("files/")) return value.slice("files/".length);
  return value;
}

// ── JSON Import (v1/v2 — backwards compatible) ──────────────────────

async function runJsonImport(job: TransferJob, filePath: string): Promise<void> {
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
      !Array.isArray(data.examples)) {
    throw new Error("Invalid export file: missing required arrays");
  }

  logger.info(
    { jobId: job.jobId, categories: data.categories.length, prompts: data.prompts.length, examples: data.examples.length },
    "JSON import started",
  );

  // 3. Run destructive import in a single transaction
  // Build prompt→category lookup so we can construct file paths for v2 imports
  const promptCategoryMap = new Map<string, string>();
  for (const p of data.prompts) {
    promptCategoryMap.set(p.id, p.category_id);
  }

  // Resolve v2 screenshot files before the transaction (file I/O outside tx)
  const resolvedScreenshots = new Map<string, {
    front: string | null;
    back: string | null;
    left: string | null;
    right: string | null;
    top: string | null;
    bottom: string | null;
    ortho45: string | null;
    ortho45Bottom: string | null;
    iso: string | null;
    isoBack: string | null;
  }>();

  // Clean existing workbench files before writing new ones
  job.progress = { phase: "cleaning old files" };
  await deleteStorageDirectory({ relativePath: "workbench" });
  logger.info({ jobId: job.jobId }, "deleted existing workbench/ directory before import");

  if (isV2) {
    job.progress = { phase: "writing screenshot files", detail: `${data.examples.length} examples` };
    for (const ex of data.examples) {
      const categoryId = promptCategoryMap.get(ex.prompt_id);
      if (categoryId) {
        resolvedScreenshots.set(ex.id, {
          front: await writeScreenshotOnImport(categoryId, ex.id, "front", ex.screenshot_front),
          back: await writeScreenshotOnImport(categoryId, ex.id, "back", ex.screenshot_back ?? null),
          left: await writeScreenshotOnImport(categoryId, ex.id, "left", ex.screenshot_left ?? null),
          right: await writeScreenshotOnImport(categoryId, ex.id, "right", ex.screenshot_right ?? null),
          top: await writeScreenshotOnImport(categoryId, ex.id, "top", ex.screenshot_top),
          bottom: await writeScreenshotOnImport(categoryId, ex.id, "bottom", ex.screenshot_bottom ?? null),
          ortho45: await writeScreenshotOnImport(categoryId, ex.id, "ortho-45", ex.screenshot_ortho_45 ?? null),
          ortho45Bottom: await writeScreenshotOnImport(categoryId, ex.id, "ortho-45-bottom", ex.screenshot_ortho_45_bottom ?? null),
          iso: await writeScreenshotOnImport(categoryId, ex.id, "iso", ex.screenshot_iso),
          isoBack: await writeScreenshotOnImport(categoryId, ex.id, "iso-back", ex.screenshot_iso_back ?? null),
        });
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    // Delete in FK order (children first)
    job.progress = { phase: "clearing existing data" };
    await tx.workbenchExample.deleteMany();
    await tx.workbenchExamplePrompt.deleteMany();
    await tx.workbenchCategory.deleteMany();

    // Insert categories
    job.progress = { phase: "inserting categories", detail: `${data.categories.length} rows` };
    for (const cat of data.categories) {
      await tx.workbenchCategory.create({
        data: {
          id: cat.id,
          rank: cat.rank,
          name: cat.name,
          complexity: cat.complexity,
          description: cat.description,
          createdAt: new Date(cat.created_at),
          updatedAt: new Date(cat.updated_at),
        },
      });
    }

    // Insert prompts (with embeddings — pgvector requires raw SQL)
    job.progress = { phase: "inserting prompts", detail: `${data.prompts.length} rows` };
    for (const p of data.prompts) {
      const embeddingValue = p.embedding
        ? `[${p.embedding.join(",")}]`
        : null;
      if (embeddingValue) {
        await tx.$executeRaw`
          INSERT INTO workbench_example_prompts (id, category_id, index, prompt, embedding, embedding_model, created_at)
          VALUES (${p.id}::uuid, ${p.category_id}::uuid, ${p.index}, ${p.prompt}, ${embeddingValue}::vector, ${p.embedding_model}, ${new Date(p.created_at)})
        `;
      } else {
        await tx.workbenchExamplePrompt.create({
          data: {
            id: p.id,
            categoryId: p.category_id,
            index: p.index,
            prompt: p.prompt,
            embeddingModel: p.embedding_model,
            createdAt: new Date(p.created_at),
          },
        });
      }
    }

    // Insert examples
    job.progress = { phase: "inserting examples", detail: `${data.examples.length} rows` };
    for (const ex of data.examples) {
      const ss = resolvedScreenshots.get(ex.id);
      const ssFront = ss ? ss.front : ex.screenshot_front;
      const ssBack = ss ? ss.back : (ex.screenshot_back ?? null);
      const ssLeft = ss ? ss.left : (ex.screenshot_left ?? null);
      const ssRight = ss ? ss.right : (ex.screenshot_right ?? null);
      const ssTop = ss ? ss.top : ex.screenshot_top;
      const ssBottom = ss ? ss.bottom : (ex.screenshot_bottom ?? null);
      const ssOrtho45 = ss ? ss.ortho45 : (ex.screenshot_ortho_45 ?? null);
      const ssOrtho45Bottom = ss ? ss.ortho45Bottom : (ex.screenshot_ortho_45_bottom ?? null);
      const ssIso = ss ? ss.iso : ex.screenshot_iso;
      const ssIsoBack = ss ? ss.isoBack : (ex.screenshot_iso_back ?? null);

      await tx.workbenchExample.create({
        data: {
          id: ex.id,
          promptId: ex.prompt_id,
          iteration: ex.iteration,
          generationSeed: ex.generation_seed,
          code: ex.code,
          renderStatus: ex.render_status,
          renderError: ex.render_error,
          stlPath: ex.stl_path,
          stepPath: ex.step_path,
          threemfPath: ex.threemf_path,
          screenshotFront: ssFront,
          screenshotBack: ssBack,
          screenshotLeft: ssLeft,
          screenshotRight: ssRight,
          screenshotTop: ssTop,
          screenshotBottom: ssBottom,
          screenshotOrtho45: ssOrtho45,
          screenshotOrtho45Bottom: ssOrtho45Bottom,
          screenshotIso: ssIso,
          screenshotIsoBack: ssIsoBack,
          evalScore: ex.eval_score,
          evalIssues: ex.eval_issues ? ex.eval_issues as object : undefined,
          evalSuggestions: ex.eval_suggestions ? ex.eval_suggestions as object : undefined,
          approvalStatus: ex.approval_status,
          rejectionNote: ex.rejection_note,
          llmModel: ex.llm_model,
          vlmModel: ex.vlm_model,
          promptTokens: ex.prompt_tokens,
          completionTokens: ex.completion_tokens,
          createdAt: new Date(ex.created_at),
          updatedAt: new Date(ex.updated_at),
        },
      });
    }
  }, { timeout: 120000 });

  // 4. Done
  job.counts = {
    categories: data.categories.length,
    prompts: data.prompts.length,
    examples: data.examples.length,
  };
  job.status = "completed";
  job.finishedAt = new Date().toISOString();
  job.progress = { phase: "done" };

  logger.info(
    { jobId: job.jobId, categories: data.categories.length, prompts: data.prompts.length, examples: data.examples.length },
    "JSON import completed",
  );
}
