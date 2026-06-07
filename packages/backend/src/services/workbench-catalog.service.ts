import { prisma } from "../db/prisma.js";
import { deleteStorageFile, FileStorageError } from "./file-storage.service.js";
import { embedAndStorePrompt } from "./workbench-embeddings.service.js";
import { collectFilePaths, type CleanupExampleRow } from "./workbench-examples.service.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("catalog");

export class WorkbenchCatalogError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

// ── Query helpers ─────────────────────────────────────────────────────

interface CategoryRow {
  id: string;
  rank: number;
  name: string;
  complexity: number;
  description: string;
  prompt_count: string;
  auto_approved_count: string;
  human_approved_count: string;
  pending_count: string;
  rejected_count: string;
  approved_prompt_count: string;
  avg_rating: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function listCategories() {
  // Count prompts that have at least one example with a given status.
  // This avoids inflated counts when a single prompt has multiple examples.
  // Complex aggregate with GROUP BY + CASE → stays as raw SQL.
  const rows = await prisma.$queryRaw<CategoryRow[]>`
    SELECT
      c.id,
      c.rank,
      c.name,
      c.complexity,
      c.description,
      COUNT(DISTINCT p.id)::text AS prompt_count,
      COUNT(DISTINCT CASE WHEN e.approval_status = 'auto_approved' THEN p.id END)::text AS auto_approved_count,
      COUNT(DISTINCT CASE WHEN e.approval_status = 'human_approved' THEN p.id END)::text AS human_approved_count,
      COUNT(DISTINCT CASE WHEN e.approval_status = 'pending' THEN p.id END)::text AS pending_count,
      COUNT(DISTINCT CASE WHEN e.approval_status = 'rejected' THEN p.id END)::text AS rejected_count,
      COUNT(DISTINCT CASE WHEN e.approval_status IN ('auto_approved', 'human_approved') THEN p.id END)::text AS approved_prompt_count,
      ROUND(AVG(e.eval_score) FILTER (WHERE e.eval_score IS NOT NULL), 1)::text AS avg_rating,
      c.created_at,
      c.updated_at
    FROM workbench_categories c
    LEFT JOIN workbench_example_prompts p ON p.category_id = c.id
    LEFT JOIN workbench_examples e ON e.prompt_id = p.id AND e.experiment_run_id IS NULL
    GROUP BY c.id
    ORDER BY c.rank
  `;

  return rows.map((row) => ({
    id: row.id,
    rank: row.rank,
    name: row.name,
    complexity: row.complexity,
    description: row.description,
    promptCount: Number(row.prompt_count),
    autoApprovedCount: Number(row.auto_approved_count),
    humanApprovedCount: Number(row.human_approved_count),
    pendingCount: Number(row.pending_count),
    rejectedCount: Number(row.rejected_count),
    approvedPromptCount: Number(row.approved_prompt_count),
    avgRating: row.avg_rating !== null ? Number(row.avg_rating) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

interface PromptRow {
  id: string;
  category_id: string;
  index: number;
  prompt: string;
  description: string | null;
  example_count: string;
  best_score: number | null;
  best_approval: string | null;
  best_example_id: string | null;
  best_eval_source: string | null;
  best_has_assertions: boolean | null;
  best_has_screenshots: boolean | null;
  has_spec: boolean;
  created_at: Date;
}

export async function listPromptsForCategory(categoryId: string) {
  // Verify category exists
  const cat = await prisma.workbenchCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
  if (!cat) {
    throw new WorkbenchCatalogError("Category not found", 404);
  }

  // Complex correlated subqueries → stays as raw SQL
  const rows = await prisma.$queryRaw<PromptRow[]>`
    SELECT
      p.id,
      p.category_id,
      p.index,
      p.prompt,
      p.description,
      COUNT(e.id)::text AS example_count,
      MAX(e.eval_score) AS best_score,
      (SELECT e2.approval_status
       FROM workbench_examples e2
       WHERE e2.prompt_id = p.id AND e2.experiment_run_id IS NULL
       ORDER BY
         CASE e2.approval_status
           WHEN 'human_approved' THEN 1
           WHEN 'auto_approved' THEN 2
           WHEN 'pending' THEN 3
           WHEN 'rejected' THEN 4
         END,
         e2.eval_score DESC NULLS LAST
       LIMIT 1
      ) AS best_approval,
      (SELECT e3.id
       FROM workbench_examples e3
       WHERE e3.prompt_id = p.id AND e3.experiment_run_id IS NULL
       ORDER BY
         CASE e3.approval_status
           WHEN 'human_approved' THEN 1
           WHEN 'auto_approved' THEN 2
           WHEN 'pending' THEN 3
           WHEN 'rejected' THEN 4
         END,
         e3.eval_score DESC NULLS LAST
       LIMIT 1
      ) AS best_example_id,
      (SELECT e4.eval_source
       FROM workbench_examples e4
       WHERE e4.prompt_id = p.id AND e4.experiment_run_id IS NULL
       ORDER BY
         CASE e4.approval_status
           WHEN 'human_approved' THEN 1
           WHEN 'auto_approved' THEN 2
           WHEN 'pending' THEN 3
           WHEN 'rejected' THEN 4
         END,
         e4.eval_score DESC NULLS LAST
       LIMIT 1
      ) AS best_eval_source,
      (SELECT e5.assertion_pass_rate IS NOT NULL
       FROM workbench_examples e5
       WHERE e5.prompt_id = p.id AND e5.experiment_run_id IS NULL
       ORDER BY
         CASE e5.approval_status
           WHEN 'human_approved' THEN 1
           WHEN 'auto_approved' THEN 2
           WHEN 'pending' THEN 3
           WHEN 'rejected' THEN 4
         END,
         e5.eval_score DESC NULLS LAST
       LIMIT 1
      ) AS best_has_assertions,
      (SELECT e6.screenshot_front IS NOT NULL
       FROM workbench_examples e6
       WHERE e6.prompt_id = p.id AND e6.experiment_run_id IS NULL
       ORDER BY
         CASE e6.approval_status
           WHEN 'human_approved' THEN 1
           WHEN 'auto_approved' THEN 2
           WHEN 'pending' THEN 3
           WHEN 'rejected' THEN 4
         END,
         e6.eval_score DESC NULLS LAST
       LIMIT 1
      ) AS best_has_screenshots,
      p.spec_interpretation IS NOT NULL AS has_spec,
      p.created_at
    FROM workbench_example_prompts p
    LEFT JOIN workbench_examples e ON e.prompt_id = p.id AND e.experiment_run_id IS NULL
    WHERE p.category_id = ${categoryId}::uuid
    GROUP BY p.id
    ORDER BY p.index
  `;

  return rows.map((row) => ({
    id: row.id,
    categoryId: row.category_id,
    index: row.index,
    prompt: row.prompt,
    description: row.description ?? null,
    exampleCount: Number(row.example_count),
    bestScore: row.best_score,
    bestApproval: row.best_approval,
    bestExampleId: row.best_example_id,
    bestEvalSource: row.best_eval_source,
    bestHasAssertions: row.best_has_assertions ?? false,
    bestHasScreenshots: row.best_has_screenshots ?? false,
    hasSpec: row.has_spec,
    createdAt: row.created_at,
  }));
}

// ── CRUD operations ─────────────────────────────────────────────────

export async function createCategory(data: {
  name: string;
  rank: number;
  complexity: number;
  description: string;
}) {
  const existing = await prisma.workbenchCategory.findUnique({ where: { rank: data.rank } });
  if (existing) {
    throw new WorkbenchCatalogError(`A category with rank ${data.rank} already exists`, 409);
  }
  const cat = await prisma.workbenchCategory.create({ data });
  logger.info({ id: cat.id, name: cat.name, rank: cat.rank }, "created workbench category");
  return cat;
}

export async function updateCategory(
  id: string,
  data: { name?: string; rank?: number; complexity?: number; description?: string },
) {
  const cat = await prisma.workbenchCategory.findUnique({ where: { id }, select: { id: true } });
  if (!cat) throw new WorkbenchCatalogError("Category not found", 404);

  if (data.rank !== undefined) {
    const conflict = await prisma.workbenchCategory.findFirst({
      where: { rank: data.rank, id: { not: id } },
      select: { id: true },
    });
    if (conflict) throw new WorkbenchCatalogError(`A category with rank ${data.rank} already exists`, 409);
  }

  await prisma.workbenchCategory.update({ where: { id }, data: { ...data, updatedAt: new Date() } });
  logger.info({ id }, "updated workbench category");
}

export async function deleteCategory(id: string) {
  const cat = await prisma.workbenchCategory.findUnique({ where: { id }, select: { id: true } });
  if (!cat) throw new WorkbenchCatalogError("Category not found", 404);

  const prompts = await prisma.workbenchExamplePrompt.findMany({
    where: { categoryId: id },
    select: { id: true },
  });
  const promptIds = prompts.map((p) => p.id);

  // Collect storage file paths BEFORE deleting DB rows (excludes experiment runs)
  const exampleRows = promptIds.length > 0
    ? await prisma.$queryRaw<CleanupExampleRow[]>`
        SELECT e.id, e.stl_path, e.step_path, e.threemf_path,
               e.screenshot_front, e.screenshot_back, e.screenshot_left, e.screenshot_right,
               e.screenshot_top, e.screenshot_bottom, e.screenshot_ortho_45, e.screenshot_ortho_45_bottom,
               e.screenshot_iso, e.screenshot_iso_back,
               p.category_id, e.approval_status, e.eval_score, e.created_at,
               (e.agent_conversation IS NOT NULL) AS has_agent_trace
        FROM workbench_examples e
        JOIN workbench_example_prompts p ON p.id = e.prompt_id
        WHERE p.category_id = ${id}::uuid AND e.experiment_run_id IS NULL
      `
    : [];
  const allFilePaths = exampleRows.flatMap(collectFilePaths);

  const deletedExamples = promptIds.length > 0
    ? await prisma.workbenchExample.deleteMany({ where: { promptId: { in: promptIds } } })
    : { count: 0 };

  // Cascade: delete prompts then category
  await prisma.workbenchExamplePrompt.deleteMany({ where: { categoryId: id } });
  await prisma.workbenchCategory.delete({ where: { id } });

  // Unlink storage files after DB rows are gone
  let filesDeleted = 0;
  for (const relativePath of allFilePaths) {
    try {
      await deleteStorageFile({ relativePath });
      filesDeleted++;
    } catch (err) {
      // FileStorageError with 404 = file already missing — silently skip
      if (err instanceof FileStorageError && err.statusCode === 404) continue;
      logger.warn({ err, relativePath }, "failed to delete file during category delete");
    }
  }

  logger.info(
    { id, deletedPrompts: promptIds.length, deletedExamples: deletedExamples.count, filesDeleted },
    "deleted workbench category",
  );
  return { deletedPrompts: promptIds.length, deletedExamples: deletedExamples.count, filesDeleted };
}

export async function createPrompts(categoryId: string, prompts: string[]): Promise<number> {
  const cat = await prisma.workbenchCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
  if (!cat) throw new WorkbenchCatalogError("Category not found", 404);
  if (!prompts.length) throw new WorkbenchCatalogError("At least one prompt is required", 400);

  // Get current max index for this category
  const maxRow = await prisma.workbenchExamplePrompt.aggregate({
    where: { categoryId },
    _max: { index: true },
  });
  const startIndex = (maxRow._max.index ?? -1) + 1;

  const data = prompts.map((prompt, i) => ({
    categoryId,
    index: startIndex + i,
    prompt: prompt.trim(),
  }));

  const result = await prisma.workbenchExamplePrompt.createMany({ data });
  logger.info({ categoryId, created: result.count }, "bulk-created workbench prompts");

  // Trigger async embedding for each new prompt
  const created = await prisma.workbenchExamplePrompt.findMany({
    where: { categoryId, index: { gte: startIndex } },
    select: { id: true, prompt: true },
    orderBy: { index: "asc" },
  });
  for (const p of created) {
    void embedAndStorePrompt(p.id, p.prompt).catch((err) =>
      logger.warn({ err, promptId: p.id }, "failed to embed new prompt"),
    );
  }

  return result.count;
}

export async function deletePrompt(promptId: string): Promise<void> {
  const prompt = await prisma.workbenchExamplePrompt.findUnique({
    where: { id: promptId },
    select: { id: true },
  });
  if (!prompt) throw new WorkbenchCatalogError("Prompt not found", 404);

  await prisma.workbenchExample.deleteMany({ where: { promptId } });
  await prisma.workbenchExamplePrompt.delete({ where: { id: promptId } });
  logger.info({ promptId }, "deleted workbench prompt");
}

export async function updatePromptText(promptId: string, newText: string, description?: string | null): Promise<void> {
  if (!newText || newText.trim().length === 0) {
    throw new WorkbenchCatalogError("Prompt text cannot be empty", 400);
  }

  const trimmed = newText.trim();
  const desc = description !== undefined ? (description?.trim() || null) : undefined;

  // Clear embedding so it gets re-generated (pgvector column → raw SQL)
  // Update description only if explicitly provided (undefined = no change)
  const count = desc !== undefined
    ? await prisma.$executeRaw`
        UPDATE workbench_example_prompts SET prompt = ${trimmed}, description = ${desc}, embedding = NULL WHERE id = ${promptId}::uuid
      `
    : await prisma.$executeRaw`
        UPDATE workbench_example_prompts SET prompt = ${trimmed}, embedding = NULL WHERE id = ${promptId}::uuid
      `;

  if (count === 0) {
    throw new WorkbenchCatalogError("Prompt not found", 404);
  }

  // Re-embed asynchronously (includes description if available)
  const finalDesc = desc !== undefined ? desc : (await prisma.workbenchExamplePrompt.findUnique({ where: { id: promptId }, select: { description: true } }))?.description;
  void embedAndStorePrompt(promptId, trimmed, finalDesc).catch((err) =>
    logger.warn({ err, promptId }, "failed to re-embed prompt"),
  );
}

