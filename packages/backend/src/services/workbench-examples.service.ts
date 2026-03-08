/**
 * Workbench Example CRUD & Export
 *
 * Handles reading, approving, rejecting, editing, and exporting
 * workbench examples.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import { deleteStorageFile } from "./file-storage.service.js";
import { WorkbenchSeederError } from "./workbench-seeder.service.js";

const logger = createLogger("workbench-examples");

// ── Types ────────────────────────────────────────────────────────────

export interface ExampleDetail {
  id: string;
  promptId: string;
  promptText: string;
  categoryName: string;
  complexity: number;
  iteration: number;
  generationSeed: number | null;
  code: string;
  renderStatus: string;
  renderError: string | null;
  stlPath: string | null;
  stepPath: string | null;
  threemfPath: string | null;
  screenshotFront: string | null;
  screenshotBack: string | null;
  screenshotLeft: string | null;
  screenshotRight: string | null;
  screenshotTop: string | null;
  screenshotBottom: string | null;
  screenshotOrtho45: string | null;
  screenshotOrtho45Bottom: string | null;
  screenshotIso: string | null;
  screenshotIsoBack: string | null;
  evalScore: number | null;
  evalIssues: string[];
  evalSuggestions: string[];
  evalChecklistResults: Array<{ question: string; pass: boolean; detail: string }> | null;
  approvalStatus: string;
  rejectionNote: string | null;
  llmModel: string | null;
  vlmModel: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  createdAt: Date;
  updatedAt: Date;
}

function parseJsonbArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string");
    } catch {
      // ignore
    }
  }
  return [];
}

function parseChecklistResultsJson(
  value: unknown,
): Array<{ question: string; pass: boolean; detail: string }> | null {
  if (value == null) return null;
  const arr = Array.isArray(value) ? value : (() => {
    if (typeof value !== "string") return null;
    try { return JSON.parse(value); } catch { return null; }
  })();
  if (!Array.isArray(arr)) return null;
  return arr
    .filter((v): v is { question: string; pass: boolean; detail: string } =>
      typeof v === "object" && v !== null &&
      typeof v.question === "string" &&
      typeof v.pass === "boolean" &&
      typeof v.detail === "string",
    );
}

// ── List examples for a prompt ───────────────────────────────────────

export async function listExamplesForPrompt(promptId: string): Promise<ExampleDetail[]> {
  const rows = await prisma.workbenchExample.findMany({
    where: { promptId },
    include: { promptRef: { include: { category: true } } },
    orderBy: { createdAt: "desc" },
  });

  return rows.map((row) => mapToExampleDetail(row, row.promptRef));
}

// ── Shared mapper ────────────────────────────────────────────────────

type ExampleWithPrompt = Awaited<ReturnType<typeof prisma.workbenchExample.findFirstOrThrow<{
  include: { promptRef: { include: { category: true } } };
}>>>;

function mapToExampleDetail(
  row: ExampleWithPrompt,
  prompt: ExampleWithPrompt["promptRef"],
): ExampleDetail {
  return {
    id: row.id,
    promptId: row.promptId,
    promptText: prompt.prompt,
    categoryName: prompt.category.name,
    complexity: prompt.category.complexity,
    iteration: row.iteration,
    generationSeed: row.generationSeed,
    code: row.code,
    renderStatus: row.renderStatus,
    renderError: row.renderError,
    stlPath: row.stlPath,
    stepPath: row.stepPath,
    threemfPath: row.threemfPath,
    screenshotFront: row.screenshotFront,
    screenshotBack: row.screenshotBack,
    screenshotLeft: row.screenshotLeft,
    screenshotRight: row.screenshotRight,
    screenshotTop: row.screenshotTop,
    screenshotBottom: row.screenshotBottom,
    screenshotOrtho45: row.screenshotOrtho45,
    screenshotOrtho45Bottom: row.screenshotOrtho45Bottom,
    screenshotIso: row.screenshotIso,
    screenshotIsoBack: row.screenshotIsoBack,
    evalScore: row.evalScore,
    evalIssues: parseJsonbArray(row.evalIssues),
    evalSuggestions: parseJsonbArray(row.evalSuggestions),
    evalChecklistResults: parseChecklistResultsJson(row.evalChecklistResults),
    approvalStatus: row.approvalStatus,
    rejectionNote: row.rejectionNote,
    llmModel: row.llmModel,
    vlmModel: row.vlmModel,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── Get single example ───────────────────────────────────────────────

export async function getExample(exampleId: string): Promise<ExampleDetail> {
  const row = await prisma.workbenchExample.findUnique({
    where: { id: exampleId },
    include: { promptRef: { include: { category: true } } },
  });

  if (!row) {
    throw new WorkbenchSeederError("Example not found", 404);
  }

  return mapToExampleDetail(row, row.promptRef);
}

// ── Approve ──────────────────────────────────────────────────────────

export async function approveExample(exampleId: string): Promise<void> {
  const { count } = await prisma.workbenchExample.updateMany({
    where: {
      id: exampleId,
      approvalStatus: { in: ["pending", "auto_approved", "rejected"] },
    },
    data: {
      approvalStatus: "human_approved",
      rejectionNote: null,
      updatedAt: new Date(),
    },
  });

  if (count === 0) {
    const check = await prisma.workbenchExample.findUnique({
      where: { id: exampleId },
      select: { approvalStatus: true },
    });
    if (!check) {
      throw new WorkbenchSeederError("Example not found", 404);
    }
    throw new WorkbenchSeederError(
      `Cannot approve example with status '${check.approvalStatus}'`,
      400,
    );
  }
}

// ── Reject ───────────────────────────────────────────────────────────

export async function rejectExample(exampleId: string, note?: string): Promise<void> {
  const { count } = await prisma.workbenchExample.updateMany({
    where: {
      id: exampleId,
      approvalStatus: { in: ["pending", "auto_approved", "human_approved"] },
    },
    data: {
      approvalStatus: "rejected",
      rejectionNote: note ?? null,
      updatedAt: new Date(),
    },
  });

  if (count === 0) {
    const check = await prisma.workbenchExample.findUnique({
      where: { id: exampleId },
      select: { approvalStatus: true },
    });
    if (!check) {
      throw new WorkbenchSeederError("Example not found", 404);
    }
    throw new WorkbenchSeederError(
      `Cannot reject example with status '${check.approvalStatus}'`,
      400,
    );
  }
}

// ── Edit code ────────────────────────────────────────────────────────

export async function updateExampleCode(exampleId: string, newCode: string): Promise<void> {
  if (!newCode || newCode.trim().length === 0) {
    throw new WorkbenchSeederError("Code cannot be empty", 400);
  }

  try {
    await prisma.workbenchExample.update({
      where: { id: exampleId },
      data: {
        code: newCode.trim(),
        renderStatus: "pending",
        renderError: null,
        screenshotFront: null,
        screenshotBack: null,
        screenshotLeft: null,
        screenshotRight: null,
        screenshotTop: null,
        screenshotBottom: null,
        screenshotOrtho45: null,
        screenshotOrtho45Bottom: null,
        screenshotIso: null,
        screenshotIsoBack: null,
        evalScore: null,
        evalIssues: Prisma.DbNull,
        evalSuggestions: Prisma.DbNull,
        approvalStatus: "pending",
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") {
      throw new WorkbenchSeederError("Example not found", 404);
    }
    throw error;
  }
}

// ── Delete ──────────────────────────────────────────────────────────

export async function deleteExample(exampleId: string): Promise<void> {
  try {
    await prisma.workbenchExample.delete({ where: { id: exampleId } });
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") {
      throw new WorkbenchSeederError("Example not found", 404);
    }
    throw error;
  }
}

export async function deleteExamplesForPrompt(promptId: string): Promise<{ deleted: number }> {
  const { count } = await prisma.workbenchExample.deleteMany({
    where: { promptId },
  });
  return { deleted: count };
}

export async function deleteExamplesForCategory(categoryId: string): Promise<{ deleted: number }> {
  const { count } = await prisma.workbenchExample.deleteMany({
    where: { promptRef: { categoryId } },
  });
  return { deleted: count };
}

// ── Cleanup (keep best, purge rest) ──────────────────────────────────

interface CleanupExampleRow {
  id: string;
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
  category_id: string;
}

/**
 * Collect all non-null file paths from an example row, including the .b123d code file.
 */
function collectFilePaths(row: CleanupExampleRow): string[] {
  const paths: string[] = [];
  if (row.stl_path) paths.push(row.stl_path);
  if (row.step_path) paths.push(row.step_path);
  if (row.threemf_path) paths.push(row.threemf_path);
  if (row.screenshot_front) paths.push(row.screenshot_front);
  if (row.screenshot_back) paths.push(row.screenshot_back);
  if (row.screenshot_left) paths.push(row.screenshot_left);
  if (row.screenshot_right) paths.push(row.screenshot_right);
  if (row.screenshot_top) paths.push(row.screenshot_top);
  if (row.screenshot_bottom) paths.push(row.screenshot_bottom);
  if (row.screenshot_ortho_45) paths.push(row.screenshot_ortho_45);
  if (row.screenshot_ortho_45_bottom) paths.push(row.screenshot_ortho_45_bottom);
  if (row.screenshot_iso) paths.push(row.screenshot_iso);
  if (row.screenshot_iso_back) paths.push(row.screenshot_iso_back);
  // .b123d code file follows the same prefix pattern
  paths.push(`workbench/${row.category_id}/${row.id}.b123d`);
  return paths;
}

/**
 * For a single prompt: keep the best example, delete all others + their files.
 *
 * Retention priority:
 * 1. approval_status: human_approved > auto_approved > pending > rejected
 * 2. eval_score DESC (highest wins)
 * 3. created_at DESC (most recent wins)
 */
export async function cleanupExamplesForPrompt(promptId: string): Promise<{
  keptId: string | null;
  deleted: number;
  filesDeleted: number;
}> {
  // Complex ORDER BY CASE → stays as raw SQL
  const rows = await prisma.$queryRaw<CleanupExampleRow[]>`
    SELECT e.id, e.stl_path, e.step_path, e.threemf_path,
            e.screenshot_front, e.screenshot_back, e.screenshot_left, e.screenshot_right,
            e.screenshot_top, e.screenshot_bottom, e.screenshot_ortho_45, e.screenshot_ortho_45_bottom,
            e.screenshot_iso, e.screenshot_iso_back,
            p.category_id
     FROM workbench_examples e
     JOIN workbench_example_prompts p ON p.id = e.prompt_id
     WHERE e.prompt_id = ${promptId}::uuid
     ORDER BY
       CASE e.approval_status
         WHEN 'human_approved' THEN 1
         WHEN 'auto_approved' THEN 2
         WHEN 'pending' THEN 3
         WHEN 'rejected' THEN 4
       END ASC,
       e.eval_score DESC NULLS LAST,
       e.created_at DESC
  `;

  if (rows.length <= 1) {
    return { keptId: rows[0]?.id ?? null, deleted: 0, filesDeleted: 0 };
  }

  const [keeper, ...toPurge] = rows;
  let filesDeleted = 0;

  for (const row of toPurge) {
    // Delete storage files
    const paths = collectFilePaths(row);
    for (const filePath of paths) {
      try {
        await deleteStorageFile({ relativePath: filePath });
        filesDeleted++;
      } catch {
        // File may already be missing — ignore
      }
    }

    // Delete DB row
    await prisma.workbenchExample.delete({ where: { id: row.id } });
  }

  logger.info(
    { promptId, kept: keeper.id, deleted: toPurge.length, filesDeleted },
    "cleaned up examples for prompt",
  );

  return { keptId: keeper.id, deleted: toPurge.length, filesDeleted };
}

// ── Public: recent approved models ───────────────────────────────────

export interface RecentApprovedModel {
  id: string;
  promptText: string;
  categoryId: string;
  categoryName: string;
  evalScore: number | null;
  createdAt: Date;
}

export async function listRecentApprovedExamples(limit = 20): Promise<RecentApprovedModel[]> {
  const rows = await prisma.workbenchExample.findMany({
    where: {
      approvalStatus: { in: ["auto_approved", "human_approved"] },
      renderStatus: "success",
      screenshotIso: { not: null },
    },
    include: { promptRef: { include: { category: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return rows.map((row) => ({
    id: row.id,
    promptText: row.promptRef.prompt,
    categoryId: row.promptRef.category.id,
    categoryName: row.promptRef.category.name,
    evalScore: row.evalScore,
    createdAt: row.createdAt,
  }));
}

interface TopRatedRow {
  id: string;
  prompt_text: string;
  category_id: string;
  category_name: string;
  complexity: number;
  eval_score: number | null;
  created_at: Date;
}

export async function listTopRatedByCategory(
  itemsPerCategory = 2,
  totalLimit = 20,
): Promise<RecentApprovedModel[]> {
  const rows = await prisma.$queryRaw<TopRatedRow[]>`
    WITH ranked AS (
      SELECT
        e.id,
        p.prompt AS prompt_text,
        c.id AS category_id,
        c.name AS category_name,
        e.eval_score,
        e.created_at,
        c.complexity,
        ROW_NUMBER() OVER (
          PARTITION BY c.id
          ORDER BY e.featured DESC, e.eval_score DESC NULLS LAST, e.created_at DESC
        ) AS rn
      FROM workbench_examples e
      JOIN workbench_example_prompts p ON p.id = e.prompt_id
      JOIN workbench_categories c ON c.id = p.category_id
      WHERE e.approval_status IN ('auto_approved', 'human_approved')
        AND e.render_status = 'success'
        AND e.screenshot_iso IS NOT NULL
    )
    SELECT id, prompt_text, category_id, category_name, complexity, eval_score, created_at
    FROM ranked
    WHERE rn <= ${itemsPerCategory}
    ORDER BY complexity DESC, eval_score DESC NULLS LAST, created_at DESC
    LIMIT ${totalLimit}
  `;

  return rows.map((r) => ({
    id: r.id,
    promptText: r.prompt_text,
    categoryId: r.category_id,
    categoryName: r.category_name,
    evalScore: r.eval_score,
    createdAt: r.created_at,
  }));
}

// ── Export stats ─────────────────────────────────────────────────────

interface CategoryStatRow {
  category_id: string;
  category_name: string;
  rank: number;
  total_prompts: string;
  total_examples: string;
  pending: string;
  auto_approved: string;
  human_approved: string;
  rejected: string;
}

export interface ExportStats {
  categories: Array<{
    categoryId: string;
    categoryName: string;
    rank: number;
    totalPrompts: number;
    totalExamples: number;
    pending: number;
    autoApproved: number;
    humanApproved: number;
    rejected: number;
  }>;
  totals: {
    totalPrompts: number;
    totalExamples: number;
    pending: number;
    autoApproved: number;
    humanApproved: number;
    rejected: number;
  };
}

export async function getExportStats(): Promise<ExportStats> {
  // Complex aggregate with GROUP BY + CASE → stays as raw SQL
  const rows = await prisma.$queryRaw<CategoryStatRow[]>`
    SELECT
      c.id AS category_id,
      c.name AS category_name,
      c.rank,
      COUNT(DISTINCT p.id)::text AS total_prompts,
      COUNT(DISTINCT e.id)::text AS total_examples,
      COUNT(DISTINCT CASE WHEN e.approval_status = 'pending' THEN e.id END)::text AS pending,
      COUNT(DISTINCT CASE WHEN e.approval_status = 'auto_approved' THEN e.id END)::text AS auto_approved,
      COUNT(DISTINCT CASE WHEN e.approval_status = 'human_approved' THEN e.id END)::text AS human_approved,
      COUNT(DISTINCT CASE WHEN e.approval_status = 'rejected' THEN e.id END)::text AS rejected
    FROM workbench_categories c
    LEFT JOIN workbench_example_prompts p ON p.category_id = c.id
    LEFT JOIN workbench_examples e ON e.prompt_id = p.id
    GROUP BY c.id
    ORDER BY c.rank
  `;

  const categories = rows.map((row) => ({
    categoryId: row.category_id,
    categoryName: row.category_name,
    rank: row.rank,
    totalPrompts: Number(row.total_prompts),
    totalExamples: Number(row.total_examples),
    pending: Number(row.pending),
    autoApproved: Number(row.auto_approved),
    humanApproved: Number(row.human_approved),
    rejected: Number(row.rejected),
  }));

  const totals = categories.reduce(
    (acc, cat) => ({
      totalPrompts: acc.totalPrompts + cat.totalPrompts,
      totalExamples: acc.totalExamples + cat.totalExamples,
      pending: acc.pending + cat.pending,
      autoApproved: acc.autoApproved + cat.autoApproved,
      humanApproved: acc.humanApproved + cat.humanApproved,
      rejected: acc.rejected + cat.rejected,
    }),
    { totalPrompts: 0, totalExamples: 0, pending: 0, autoApproved: 0, humanApproved: 0, rejected: 0 },
  );

  return { categories, totals };
}

// ── JSONL Export ─────────────────────────────────────────────────────

export async function exportApprovedJsonl(): Promise<string> {
  // Get the active system prompt content
  const sp = await prisma.workbenchSystemPrompt.findFirst({
    where: { isActive: true },
    select: { content: true },
  });
  const systemPromptContent = sp?.content ?? "";

  // Fetch all approved examples with their prompt text
  const rows = await prisma.workbenchExample.findMany({
    where: {
      approvalStatus: { in: ["auto_approved", "human_approved"] },
      renderStatus: "success",
    },
    select: {
      code: true,
      evalScore: true,
      promptRef: {
        select: { prompt: true, categoryId: true, index: true },
      },
    },
    orderBy: [
      { promptRef: { categoryId: "asc" } },
      { promptRef: { index: "asc" } },
      { evalScore: "desc" },
    ],
  });

  const lines = rows.map((row) => {
    const record = {
      conversations: [
        { from: "system", value: systemPromptContent },
        { from: "human", value: row.promptRef.prompt },
        { from: "gpt", value: `\`\`\`python\n${row.code}\n\`\`\`` },
      ],
    };
    return JSON.stringify(record);
  });

  return lines.join("\n");
}
