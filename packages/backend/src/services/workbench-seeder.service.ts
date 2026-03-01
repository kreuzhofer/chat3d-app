import { prisma } from "../db/prisma.js";
import { embedAndStorePrompt } from "./workbench-embeddings.service.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("seed");

export class WorkbenchSeederError extends Error {
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
      ROUND(AVG(e.eval_score) FILTER (WHERE e.eval_score IS NOT NULL), 1)::text AS avg_rating,
      c.created_at,
      c.updated_at
    FROM workbench_categories c
    LEFT JOIN workbench_example_prompts p ON p.category_id = c.id
    LEFT JOIN workbench_examples e ON e.prompt_id = p.id
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
  example_count: string;
  best_score: number | null;
  best_approval: string | null;
  best_example_id: string | null;
  created_at: Date;
}

export async function listPromptsForCategory(categoryId: string) {
  // Verify category exists
  const cat = await prisma.workbenchCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
  if (!cat) {
    throw new WorkbenchSeederError("Category not found", 404);
  }

  // Complex correlated subqueries → stays as raw SQL
  const rows = await prisma.$queryRaw<PromptRow[]>`
    SELECT
      p.id,
      p.category_id,
      p.index,
      p.prompt,
      COUNT(e.id)::text AS example_count,
      MAX(e.eval_score) AS best_score,
      (SELECT e2.approval_status
       FROM workbench_examples e2
       WHERE e2.prompt_id = p.id
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
       WHERE e3.prompt_id = p.id
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
      p.created_at
    FROM workbench_example_prompts p
    LEFT JOIN workbench_examples e ON e.prompt_id = p.id
    WHERE p.category_id = ${categoryId}::uuid
    GROUP BY p.id
    ORDER BY p.index
  `;

  return rows.map((row) => ({
    id: row.id,
    categoryId: row.category_id,
    index: row.index,
    prompt: row.prompt,
    exampleCount: Number(row.example_count),
    bestScore: row.best_score,
    bestApproval: row.best_approval,
    bestExampleId: row.best_example_id,
    createdAt: row.created_at,
  }));
}

export async function updatePromptText(promptId: string, newText: string): Promise<void> {
  if (!newText || newText.trim().length === 0) {
    throw new WorkbenchSeederError("Prompt text cannot be empty", 400);
  }

  const trimmed = newText.trim();

  // Clear embedding so it gets re-generated (pgvector column → raw SQL)
  const count = await prisma.$executeRaw`
    UPDATE workbench_example_prompts SET prompt = ${trimmed}, embedding = NULL WHERE id = ${promptId}::uuid
  `;

  if (count === 0) {
    throw new WorkbenchSeederError("Prompt not found", 404);
  }

  // Re-embed asynchronously
  void embedAndStorePrompt(promptId, trimmed).catch((err) =>
    logger.warn({ err, promptId }, "failed to re-embed prompt"),
  );
}

// ── System prompt CRUD ──────────────────────────────────────────────

export async function listSystemPrompts() {
  const rows = await prisma.workbenchSystemPrompt.findMany({
    orderBy: { version: "desc" },
  });

  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    label: row.label,
    content: row.content,
    isActive: row.isActive,
    createdAt: row.createdAt,
  }));
}

export async function getActiveSystemPrompt() {
  const row = await prisma.workbenchSystemPrompt.findFirst({
    where: { isActive: true },
  });

  if (!row) {
    throw new WorkbenchSeederError("No active system prompt found", 404);
  }

  return {
    id: row.id,
    version: row.version,
    label: row.label,
    content: row.content,
    isActive: row.isActive,
    createdAt: row.createdAt,
  };
}

export async function activateSystemPrompt(promptId: string) {
  await prisma.$transaction(async (tx) => {
    // Verify prompt exists
    const check = await tx.workbenchSystemPrompt.findUnique({
      where: { id: promptId },
      select: { id: true },
    });
    if (!check) {
      throw new WorkbenchSeederError("System prompt not found", 404);
    }

    // Deactivate all, then activate the target
    await tx.workbenchSystemPrompt.updateMany({
      data: { isActive: false },
    });
    await tx.workbenchSystemPrompt.update({
      where: { id: promptId },
      data: { isActive: true },
    });
  });
}
