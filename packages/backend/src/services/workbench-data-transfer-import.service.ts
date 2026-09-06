/**
 * Workbench Data Transfer — Import Logic
 *
 * Supports v3 ZIP imports (current) and v1/v2 JSON imports (backwards compatible).
 */

import { promises as fs } from "node:fs";
import { Open as unzipperOpen } from "unzipper";
import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import {
  deleteStorageDirectory,
  writeStorageFile,
  writeStorageFileFromBuffer,
} from "./file-storage.service.js";
import type {
  TransferJob,
  ExportPrompt,
  ExportExample,
  WorkbenchExportData,
} from "./workbench-data-transfer.service.js";
import {
  SCREENSHOT_ANGLES,
  remapLegacyWorkbenchPath,
  remapNullable,
  stripFilesPrefix,
} from "./workbench-data-transfer.service.js";

const logger = createLogger("data-transfer-import");

// ── Entry point ─────────────────────────────────────────────────────

export async function runImport(job: TransferJob, filePath: string): Promise<void> {
  try {
    job.progress = { phase: "detecting format" };
    const header = Buffer.alloc(2);
    const fd = await fs.open(filePath, "r");
    try { await fd.read(header, 0, 2, 0); } finally { await fd.close(); }

    const isZip = header[0] === 0x50 && header[1] === 0x4B;
    if (isZip) {
      await runZipImport(job, filePath);
    } else {
      await runJsonImport(job, filePath);
    }

    try { await fs.unlink(filePath); } catch { /* non-fatal */ }
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : String(error);
    job.finishedAt = new Date().toISOString();
    logger.error({ jobId: job.jobId, err: job.error }, "import failed");
  }
}

// ── Screenshot helpers ──────────────────────────────────────────────

async function writeScreenshotOnImport(
  categoryId: string, exampleId: string, angle: string, base64Value: string | null,
): Promise<string | null> {
  if (!base64Value) return null;
  const relativePath = `workbench/${categoryId}/artifacts/${exampleId}-screenshot-${angle}.png`;
  try {
    await writeStorageFile({ relativePath, contentBase64: base64Value });
    return relativePath;
  } catch (err) {
    logger.warn({ relativePath, err }, "could not write screenshot file during import, storing base64 in DB");
    return base64Value;
  }
}

// ── Shared insert helpers ───────────────────────────────────────────

async function insertPrompts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  prompts: ExportPrompt[],
  job: TransferJob,
): Promise<void> {
  job.progress = { phase: "inserting prompts", detail: `${prompts.length} rows` };
  for (const p of prompts) {
    // Always create via Prisma for all non-vector fields
    await tx.workbenchExamplePrompt.create({
      data: {
        id: p.id,
        categoryId: p.category_id,
        index: p.index,
        prompt: p.prompt,
        embeddingModel: p.embedding_model,
        constructionSpec: p.construction_spec ?? null,
        specEmbeddingModel: p.spec_embedding_model ?? null,
        disambiguationQuestions: p.disambiguation_questions ? p.disambiguation_questions as object : undefined,
        disambiguationStatus: p.disambiguation_status ?? null,
        specInterpretation: p.spec_interpretation ?? null,
        detectedOperations: p.detected_operations ?? [],
        description: p.description ?? null,
        codeAssertions: p.code_assertions ? p.code_assertions as object : undefined,
        verificationChecklist: p.verification_checklist ? p.verification_checklist as object : undefined,
        verificationCriteria: p.verification_criteria ? p.verification_criteria as object : undefined,
        specRawResponse: p.spec_raw_response ?? null,
        specSystemPrompt: p.spec_system_prompt ?? null,
        enrichmentRawResponse: p.enrichment_raw_response ?? null,
        enrichmentSystemPrompt: p.enrichment_system_prompt ?? null,
        enrichmentUserMessage: p.enrichment_user_message ?? null,
        createdAt: new Date(p.created_at),
      },
    });

    // Update vector columns via raw SQL (Prisma can't handle pgvector)
    const embeddingValue = p.embedding ? `[${p.embedding.join(",")}]` : null;
    const specEmbeddingValue = p.spec_embedding ? `[${p.spec_embedding.join(",")}]` : null;
    if (embeddingValue || specEmbeddingValue) {
      await tx.$executeRaw`
        UPDATE workbench_example_prompts
        SET embedding = ${embeddingValue}::vector,
            spec_embedding = ${specEmbeddingValue}::vector
        WHERE id = ${p.id}::uuid
      `;
    }
  }
}

async function insertExamples(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  examples: ExportExample[],
  screenshotResolver: (ex: ExportExample, angle: string) => string | null,
  job: TransferJob,
): Promise<void> {
  job.progress = { phase: "inserting examples", detail: `${examples.length} rows` };
  for (const ex of examples) {
    await tx.workbenchExample.create({
      data: {
        id: ex.id,
        promptId: ex.prompt_id,
        iteration: ex.iteration,
        generationSeed: ex.generation_seed,
        code: ex.code,
        renderStatus: ex.render_status,
        renderError: ex.render_error,
        stlPath: ex.stl_path ? remapLegacyWorkbenchPath(ex.stl_path) : null,
        stepPath: ex.step_path ? remapLegacyWorkbenchPath(ex.step_path) : null,
        threemfPath: ex.threemf_path ? remapLegacyWorkbenchPath(ex.threemf_path) : null,
        screenshotFront: screenshotResolver(ex, "front"),
        screenshotBack: screenshotResolver(ex, "back"),
        screenshotLeft: screenshotResolver(ex, "left"),
        screenshotRight: screenshotResolver(ex, "right"),
        screenshotTop: screenshotResolver(ex, "top"),
        screenshotBottom: screenshotResolver(ex, "bottom"),
        screenshotOrtho45: screenshotResolver(ex, "ortho-45"),
        screenshotOrtho45Bottom: screenshotResolver(ex, "ortho-45-bottom"),
        screenshotIso: screenshotResolver(ex, "iso"),
        screenshotIsoBack: screenshotResolver(ex, "iso-back"),
        evalScore: ex.eval_score,
        evalIssues: ex.eval_issues ? ex.eval_issues as object : undefined,
        evalSuggestions: ex.eval_suggestions ? ex.eval_suggestions as object : undefined,
        evalChecklistResults: ex.eval_checklist_results ? ex.eval_checklist_results as object : undefined,
        approvalStatus: ex.approval_status,
        rejectionNote: ex.rejection_note,
        llmModel: ex.llm_model,
        vlmModel: ex.vlm_model,
        vlmRawResponse: ex.vlm_raw_response ?? null,
        vlmReasoning: ex.vlm_reasoning ?? null,
        vlmSystemPrompt: ex.vlm_system_prompt ?? null,
        vlmInstrumentId: ex.vlm_instrument_id ?? null,
        vlmThinkingEffort: ex.vlm_thinking_effort ?? null,
        codeReviewRawResponse: ex.code_review_raw_response ?? null,
        codeReviewReasoning: ex.code_review_reasoning ?? null,
        codeReviewSystemPrompt: ex.code_review_system_prompt ?? null,
        agentConversation: ex.agent_conversation ? ex.agent_conversation as object : undefined,
        agentSystemPrompt: ex.agent_system_prompt ?? null,
        promptTokens: ex.prompt_tokens,
        completionTokens: ex.completion_tokens,
        featured: ex.featured ?? false,
        visualScore: ex.visual_score,
        codeEvalScore: ex.code_eval_score,
        assertionPassRate: ex.assertion_pass_rate,
        evalSource: ex.eval_source ?? null,
        // experimentRunId intentionally omitted — FK target not part of this export
        createdAt: new Date(ex.created_at),
        updatedAt: new Date(ex.updated_at),
      },
    });
  }
}

async function insertTags(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  data: WorkbenchExportData,
  job: TransferJob,
): Promise<void> {
  const exportTags = data.tags;
  const exportPromptTags = data.prompt_tags;
  if (!exportTags?.length || !exportPromptTags?.length) return;

  job.progress = { phase: "importing tags", detail: `${exportTags.length} tags, ${exportPromptTags.length} associations` };

  // Delete workbench prompt-tag associations (not the tags themselves — curation uses them too)
  await tx.workbenchPromptTag.deleteMany();

  // Upsert tags by name, building an ID remap for tags that already exist
  const idRemap = new Map<string, string>(); // export ID → actual DB ID
  for (const tag of exportTags) {
    const existing = await tx.tag.findUnique({ where: { name: tag.name } });
    if (existing) {
      idRemap.set(tag.id, existing.id);
    } else {
      await tx.tag.create({ data: { id: tag.id, name: tag.name } });
      idRemap.set(tag.id, tag.id);
    }
  }

  // Recreate prompt-tag associations with remapped IDs
  for (const pt of exportPromptTags) {
    const actualTagId = idRemap.get(pt.tag_id);
    if (!actualTagId) continue;
    await tx.workbenchPromptTag.create({
      data: { promptId: pt.prompt_id, tagId: actualTagId },
    });
  }
}

// ── ZIP Import (v3) ──────────────────────────────────────────────────

async function runZipImport(job: TransferJob, filePath: string): Promise<void> {
  job.progress = { phase: "reading ZIP manifest" };
  const directory = await unzipperOpen.file(filePath);

  const manifestEntry = directory.files.find((f) => f.path === "manifest.json");
  if (!manifestEntry) throw new Error("ZIP file does not contain manifest.json");

  const manifestBuffer = await manifestEntry.buffer();
  const data = JSON.parse(manifestBuffer.toString("utf-8")) as WorkbenchExportData;

  if (data.version !== 3) throw new Error(`Unexpected manifest version in ZIP: ${data.version} (expected 3)`);
  if (!Array.isArray(data.categories) || !Array.isArray(data.prompts) || !Array.isArray(data.examples)) {
    throw new Error("Invalid manifest: missing required arrays");
  }

  logger.info(
    { jobId: job.jobId, categories: data.categories.length, prompts: data.prompts.length, examples: data.examples.length },
    "ZIP import started",
  );

  // Extract files
  job.progress = { phase: "cleaning old files" };
  await deleteStorageDirectory({ relativePath: "workbench" });

  const fileEntries = directory.files.filter((f) => f.path.startsWith("files/") && f.type === "File");
  job.progress = { phase: "extracting files", detail: `${fileEntries.length} files` };

  let extractedCount = 0;
  for (const entry of fileEntries) {
    const rawPath = entry.path.slice("files/".length);
    if (!rawPath) continue;
    const relativePath = remapLegacyWorkbenchPath(rawPath);
    const buffer = await entry.buffer();
    await writeStorageFileFromBuffer({ relativePath, content: buffer });
    extractedCount++;
    if (extractedCount % 50 === 0) {
      job.progress = { phase: "extracting files", detail: `${extractedCount} / ${fileEntries.length}` };
    }
  }
  logger.info({ jobId: job.jobId, extractedCount }, "ZIP files extracted to storage");

  // Database transaction
  await prisma.$transaction(async (tx) => {
    job.progress = { phase: "clearing existing data" };
    await tx.generationTrace.deleteMany({ where: { workbenchExampleId: { not: null } } });
    await tx.workbenchExample.deleteMany();
    await tx.workbenchExamplePrompt.deleteMany();
    await tx.workbenchCategory.deleteMany();

    job.progress = { phase: "inserting categories", detail: `${data.categories.length} rows` };
    for (const cat of data.categories) {
      await tx.workbenchCategory.create({
        data: {
          id: cat.id, rank: cat.rank, name: cat.name, complexity: cat.complexity,
          description: cat.description,
          createdAt: new Date(cat.created_at), updatedAt: new Date(cat.updated_at),
        },
      });
    }

    await insertPrompts(tx, data.prompts, job);

    // ZIP screenshot resolver: strip files/ prefix and remap legacy paths
    const zipScreenshotResolver = (ex: ExportExample, angle: string): string | null => {
      const key = angle.replace(/-/g, "_") as keyof ExportExample;
      const snakeKey = `screenshot_${key}` as keyof ExportExample;
      const value = (ex[snakeKey] ?? null) as string | null;
      return remapNullable(stripFilesPrefix(value));
    };
    await insertExamples(tx, data.examples, zipScreenshotResolver, job);

    // Traces
    if (data.traces?.length) {
      job.progress = { phase: "inserting traces", detail: `${data.traces.length} rows` };
      for (const t of data.traces) {
        await tx.generationTrace.create({
          data: {
            id: t.id, workbenchExampleId: t.workbench_example_id,
            totalDurationMs: t.total_duration_ms, totalCostUsd: t.total_cost_usd,
            totalSteps: t.total_steps, totalLlmCalls: t.total_llm_calls,
            finalStatus: t.final_status, pipelineType: t.pipeline_type,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            trace: t.trace as any, createdAt: new Date(t.created_at),
          },
        });
      }
    }

    // Tags
    await insertTags(tx, data, job);
  }, { timeout: 120000 });

  const traceCount = data.traces?.length ?? 0;
  const tagCount = data.tags?.length ?? 0;
  job.counts = {
    categories: data.categories.length, prompts: data.prompts.length,
    examples: data.examples.length, traces: traceCount, tags: tagCount,
  };
  job.status = "completed";
  job.finishedAt = new Date().toISOString();
  job.progress = { phase: "done" };

  logger.info(
    { jobId: job.jobId, categories: data.categories.length, prompts: data.prompts.length, examples: data.examples.length, traces: traceCount, tags: tagCount, files: extractedCount },
    "ZIP import completed",
  );
}

// ── JSON Import (v1/v2 — backwards compatible) ──────────────────────

async function runJsonImport(job: TransferJob, filePath: string): Promise<void> {
  job.progress = { phase: "reading file" };
  const raw = await fs.readFile(filePath, "utf-8");
  job.progress = { phase: "parsing JSON" };
  const data = JSON.parse(raw) as WorkbenchExportData;

  if (!data.version || (data.version !== 1 && data.version !== 2)) {
    throw new Error(`Unsupported export version: ${data.version}`);
  }
  const isV2 = data.version === 2;
  if (!Array.isArray(data.categories) || !Array.isArray(data.prompts) || !Array.isArray(data.examples)) {
    throw new Error("Invalid export file: missing required arrays");
  }

  logger.info(
    { jobId: job.jobId, categories: data.categories.length, prompts: data.prompts.length, examples: data.examples.length },
    "JSON import started",
  );

  // Build prompt→category lookup for v2 screenshot file paths
  const promptCategoryMap = new Map<string, string>();
  for (const p of data.prompts) promptCategoryMap.set(p.id, p.category_id);

  // Resolve v2 screenshots before the transaction (file I/O outside tx)
  const resolvedScreenshots = new Map<string, Record<string, string | null>>();

  job.progress = { phase: "cleaning old files" };
  await deleteStorageDirectory({ relativePath: "workbench" });

  if (isV2) {
    job.progress = { phase: "writing screenshot files", detail: `${data.examples.length} examples` };
    for (const ex of data.examples) {
      const categoryId = promptCategoryMap.get(ex.prompt_id);
      if (!categoryId) continue;
      const resolved: Record<string, string | null> = {};
      for (const angle of SCREENSHOT_ANGLES) {
        const snakeKey = `screenshot_${angle.suffix.replace(/-/g, "_")}` as keyof ExportExample;
        const value = (ex[snakeKey] ?? null) as string | null;
        resolved[angle.suffix] = await writeScreenshotOnImport(categoryId, ex.id, angle.suffix, value);
      }
      resolvedScreenshots.set(ex.id, resolved);
    }
  }

  await prisma.$transaction(async (tx) => {
    job.progress = { phase: "clearing existing data" };
    await tx.generationTrace.deleteMany({ where: { workbenchExampleId: { not: null } } });
    await tx.workbenchExample.deleteMany();
    await tx.workbenchExamplePrompt.deleteMany();
    await tx.workbenchCategory.deleteMany();

    job.progress = { phase: "inserting categories", detail: `${data.categories.length} rows` };
    for (const cat of data.categories) {
      await tx.workbenchCategory.create({
        data: {
          id: cat.id, rank: cat.rank, name: cat.name, complexity: cat.complexity,
          description: cat.description,
          createdAt: new Date(cat.created_at), updatedAt: new Date(cat.updated_at),
        },
      });
    }

    await insertPrompts(tx, data.prompts, job);

    // JSON screenshot resolver: use pre-resolved screenshots for v2, or raw values
    const jsonScreenshotResolver = (ex: ExportExample, angle: string): string | null => {
      const ss = resolvedScreenshots.get(ex.id);
      if (ss) return ss[angle] ?? null;
      const snakeKey = `screenshot_${angle.replace(/-/g, "_")}` as keyof ExportExample;
      return (ex[snakeKey] ?? null) as string | null;
    };
    await insertExamples(tx, data.examples, jsonScreenshotResolver, job);

    // Tags (may exist in v1/v2 if re-exported, handled gracefully)
    await insertTags(tx, data, job);
  }, { timeout: 120000 });

  job.counts = {
    categories: data.categories.length, prompts: data.prompts.length,
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
