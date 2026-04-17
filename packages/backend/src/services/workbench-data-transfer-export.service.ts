/**
 * Workbench Data Transfer — Export Logic
 *
 * Produces a v3 ZIP containing manifest.json + all model/screenshot files.
 */

import { promises as fs } from "node:fs";
import { createWriteStream } from "node:fs";
import path from "node:path";
import archiver from "archiver";
import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import {
  getStorageAbsolutePath,
  storageFileExists,
} from "./file-storage.service.js";
import { createBackup } from "./backup.service.js";
import type {
  TransferJob,
  ExportCategory,
  ExportPrompt,
  ExportExample,
  ExportTrace,
  ExportTag,
  ExportPromptTag,
  WorkbenchExportData,
} from "./workbench-data-transfer.service.js";
import {
  SCREENSHOT_ANGLES,
  getExportsDir,
} from "./workbench-data-transfer.service.js";

const logger = createLogger("data-transfer-export");

export async function runExport(job: TransferJob): Promise<void> {
  try {
    const exportsDir = getExportsDir();
    await fs.mkdir(exportsDir, { recursive: true });

    // 1. Categories
    job.progress = { phase: "querying categories" };
    const catRows = await prisma.workbenchCategory.findMany({ orderBy: { rank: "asc" } });
    const categories: ExportCategory[] = catRows.map((r) => ({
      id: r.id, rank: r.rank, name: r.name, complexity: r.complexity,
      description: r.description,
      created_at: r.createdAt.toISOString(), updated_at: r.updatedAt.toISOString(),
    }));

    // 2. Prompts (embedding needs raw SQL — pgvector cast to text)
    job.progress = { phase: "querying prompts", detail: `${categories.length} categories found` };
    const promptRows = await prisma.$queryRaw<{
      id: string; category_id: string; index: number; prompt: string;
      embedding: string | null; embedding_model: string | null;
      construction_spec: string | null;
      spec_embedding: string | null; spec_embedding_model: string | null;
      disambiguation_questions: unknown | null; disambiguation_status: string | null;
      spec_interpretation: string | null; detected_operations: string[];
      description: string | null; code_assertions: unknown | null;
      verification_checklist: unknown | null; verification_criteria: unknown | null;
      spec_raw_response: string | null; spec_system_prompt: string | null;
      enrichment_raw_response: string | null; enrichment_system_prompt: string | null;
      enrichment_user_message: string | null;
      created_at: Date;
    }[]>`
      SELECT id, category_id, index, prompt,
             embedding::text AS embedding, embedding_model,
             construction_spec,
             spec_embedding::text AS spec_embedding, spec_embedding_model,
             disambiguation_questions, disambiguation_status,
             spec_interpretation, detected_operations, description,
             code_assertions, verification_checklist, verification_criteria,
             spec_raw_response, spec_system_prompt,
             enrichment_raw_response, enrichment_system_prompt, enrichment_user_message,
             created_at
      FROM workbench_example_prompts
      ORDER BY category_id, index ASC
    `;
    const prompts: ExportPrompt[] = promptRows.map((r) => ({
      id: r.id, category_id: r.category_id, index: r.index, prompt: r.prompt,
      embedding: r.embedding ? JSON.parse(r.embedding) : null,
      embedding_model: r.embedding_model ?? null,
      construction_spec: r.construction_spec ?? null,
      spec_embedding: r.spec_embedding ? JSON.parse(r.spec_embedding) : null,
      spec_embedding_model: r.spec_embedding_model ?? null,
      disambiguation_questions: r.disambiguation_questions ?? null,
      disambiguation_status: r.disambiguation_status ?? null,
      spec_interpretation: r.spec_interpretation ?? null,
      detected_operations: r.detected_operations ?? [],
      description: r.description ?? null,
      code_assertions: r.code_assertions ?? null,
      verification_checklist: r.verification_checklist ?? null,
      verification_criteria: r.verification_criteria ?? null,
      spec_raw_response: r.spec_raw_response ?? null,
      spec_system_prompt: r.spec_system_prompt ?? null,
      enrichment_raw_response: r.enrichment_raw_response ?? null,
      enrichment_system_prompt: r.enrichment_system_prompt ?? null,
      enrichment_user_message: r.enrichment_user_message ?? null,
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }));

    const promptCategoryMap = new Map<string, string>();
    for (const p of prompts) promptCategoryMap.set(p.id, p.category_id);

    // 3. Examples
    job.progress = { phase: "querying examples", detail: `${prompts.length} prompts found` };
    const exampleRows = await prisma.workbenchExample.findMany({
      orderBy: [{ promptId: "asc" }, { iteration: "asc" }],
    });

    job.progress = { phase: "building manifest", detail: `${exampleRows.length} examples` };
    const examples: ExportExample[] = [];
    const filesToArchive: Array<{ zipPath: string; storagePath: string }> = [];

    for (const r of exampleRows) {
      const categoryId = promptCategoryMap.get(r.promptId);
      const filePrefix = categoryId ? `files/workbench/${categoryId}/${r.id}` : null;

      // Collect model files
      for (const { dbPath } of [
        { dbPath: r.stlPath, ext: "stl" },
        { dbPath: r.stepPath, ext: "step" },
        { dbPath: r.threemfPath, ext: "3mf" },
      ]) {
        if (dbPath && filePrefix && await storageFileExists(dbPath)) {
          filesToArchive.push({ zipPath: `files/${dbPath}`, storagePath: dbPath });
        }
      }

      // b123d source file
      if (categoryId) {
        const b123dNewPath = `workbench/${categoryId}/code/${r.id}.b123d`;
        const b123dOldPath = `workbench/${categoryId}/${r.id}.b123d`;
        const b123dPath = (await storageFileExists(b123dNewPath)) ? b123dNewPath
          : (await storageFileExists(b123dOldPath)) ? b123dOldPath : null;
        if (b123dPath) {
          filesToArchive.push({ zipPath: `files/${b123dPath}`, storagePath: b123dPath });
        }
      }

      // Screenshot files
      const screenshotManifest: Record<string, string | null> = {};
      for (const angle of SCREENSHOT_ANGLES) {
        const dbValue = r[angle.column] as string | null | undefined;
        if (dbValue && dbValue.startsWith("workbench/") && filePrefix) {
          if (await storageFileExists(dbValue)) {
            filesToArchive.push({ zipPath: `files/${dbValue}`, storagePath: dbValue });
            screenshotManifest[angle.suffix] = `files/${dbValue}`;
          } else {
            screenshotManifest[angle.suffix] = null;
          }
        } else if (dbValue && !dbValue.startsWith("workbench/")) {
          screenshotManifest[angle.suffix] = dbValue; // Legacy base64
        } else {
          screenshotManifest[angle.suffix] = null;
        }
      }

      examples.push({
        id: r.id, prompt_id: r.promptId, iteration: r.iteration,
        generation_seed: r.generationSeed ?? null, code: r.code,
        render_status: r.renderStatus, render_error: r.renderError ?? null,
        stl_path: r.stlPath ?? null, step_path: r.stepPath ?? null, threemf_path: r.threemfPath ?? null,
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
        eval_score: r.evalScore ? Number(r.evalScore) : null,
        eval_issues: r.evalIssues ?? null,
        eval_suggestions: r.evalSuggestions ?? null,
        eval_checklist_results: r.evalChecklistResults ?? null,
        approval_status: r.approvalStatus, rejection_note: r.rejectionNote ?? null,
        llm_model: r.llmModel ?? null, vlm_model: r.vlmModel ?? null,
        vlm_raw_response: r.vlmRawResponse ?? null,
        vlm_reasoning: r.vlmReasoning ?? null,
        vlm_system_prompt: r.vlmSystemPrompt ?? null,
        code_review_raw_response: r.codeReviewRawResponse ?? null,
        code_review_reasoning: r.codeReviewReasoning ?? null,
        code_review_system_prompt: r.codeReviewSystemPrompt ?? null,
        agent_conversation: r.agentConversation ?? null,
        agent_system_prompt: r.agentSystemPrompt ?? null,
        prompt_tokens: r.promptTokens ?? null, completion_tokens: r.completionTokens ?? null,
        featured: r.featured,
        visual_score: r.visualScore ? Number(r.visualScore) : null,
        code_eval_score: r.codeEvalScore ? Number(r.codeEvalScore) : null,
        assertion_pass_rate: r.assertionPassRate ? Number(r.assertionPassRate) : null,
        eval_source: r.evalSource ?? null,
        experiment_run_id: r.experimentRunId ?? null,
        created_at: r.createdAt.toISOString(), updated_at: r.updatedAt.toISOString(),
      });
    }

    // 4. Traces
    job.progress = { phase: "querying traces" };
    const traceRows = await prisma.generationTrace.findMany({
      where: { workbenchExampleId: { not: null } },
    });
    const traces: ExportTrace[] = traceRows.map((r) => ({
      id: r.id, workbench_example_id: r.workbenchExampleId!,
      total_duration_ms: r.totalDurationMs, total_cost_usd: r.totalCostUsd ? Number(r.totalCostUsd) : null,
      total_steps: r.totalSteps, total_llm_calls: r.totalLlmCalls,
      final_status: r.finalStatus, pipeline_type: r.pipelineType,
      trace: r.trace, created_at: r.createdAt.toISOString(),
    }));

    // 5. Tags + prompt-tag associations
    job.progress = { phase: "querying tags" };
    const promptTagRows = await prisma.workbenchPromptTag.findMany({ include: { tag: true } });
    const tagMap = new Map<string, ExportTag>();
    const promptTags: ExportPromptTag[] = [];
    for (const pt of promptTagRows) {
      if (!tagMap.has(pt.tagId)) {
        tagMap.set(pt.tagId, { id: pt.tag.id, name: pt.tag.name });
      }
      promptTags.push({ prompt_id: pt.promptId, tag_id: pt.tagId });
    }
    const tags = Array.from(tagMap.values());

    // 6. Write ZIP
    job.progress = { phase: "writing ZIP", detail: `${filesToArchive.length} files to archive` };
    const manifest: WorkbenchExportData = {
      version: 3, exportedAt: new Date().toISOString(),
      categories, prompts, examples, traces, tags, prompt_tags: promptTags,
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const fileName = `workbench-export-${timestamp}.zip`;
    const filePath = path.join(exportsDir, fileName);
    await writeZipExport(filePath, manifest, filesToArchive, job);

    // 7. Done
    job.filePath = filePath;
    job.counts = {
      categories: categories.length, prompts: prompts.length,
      examples: examples.length, traces: traces.length, tags: tags.length,
    };
    job.status = "completed";
    job.finishedAt = new Date().toISOString();
    job.progress = { phase: "done" };

    logger.info(
      { jobId: job.jobId, categories: categories.length, prompts: prompts.length, examples: examples.length, tags: tags.length, files: filesToArchive.length, filePath },
      "ZIP export completed",
    );

    // 8. Backup record (non-fatal)
    try {
      const fileStat = await fs.stat(filePath);
      await createBackup({
        type: "workbench", label: `Workbench Export ${timestamp}`,
        fileName, filePath, sizeBytes: BigInt(fileStat.size),
        counts: job.counts ? { ...job.counts } as Record<string, number> : undefined,
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
    archive.on("warning", (err: Error) => { logger.warn({ err }, "archiver warning"); });
    archive.pipe(writeStream);

    archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });

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
