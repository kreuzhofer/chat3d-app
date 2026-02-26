/**
 * Workbench Example CRUD & Export
 *
 * Handles reading, approving, rejecting, editing, and exporting
 * workbench examples.
 */

import { pool } from "../db/connection.js";
import { WorkbenchSeederError } from "./workbench-seeder.service.js";

// ── Types ────────────────────────────────────────────────────────────

interface ExampleRow {
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
  screenshot_bottom: string | null;
  eval_score: number | null;
  eval_issues: unknown;
  eval_suggestions: unknown;
  approval_status: string;
  rejection_note: string | null;
  llm_model: string | null;
  vlm_model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  created_at: Date;
  updated_at: Date;
  // Joined fields
  prompt_text?: string;
  category_name?: string;
  complexity?: number;
}

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
  screenshotTop: string | null;
  screenshotIso: string | null;
  screenshotIsoBack: string | null;
  screenshotBottom: string | null;
  evalScore: number | null;
  evalIssues: string[];
  evalSuggestions: string[];
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

// ── List examples for a prompt ───────────────────────────────────────

export async function listExamplesForPrompt(promptId: string): Promise<ExampleDetail[]> {
  const result = await pool.query<ExampleRow>(
    `SELECT
       e.*,
       p.prompt AS prompt_text,
       c.name AS category_name,
       c.complexity
     FROM workbench_examples e
     JOIN workbench_example_prompts p ON p.id = e.prompt_id
     JOIN workbench_categories c ON c.id = p.category_id
     WHERE e.prompt_id = $1
     ORDER BY e.created_at DESC`,
    [promptId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    promptId: row.prompt_id,
    promptText: row.prompt_text ?? "",
    categoryName: row.category_name ?? "",
    complexity: row.complexity ?? 1,
    iteration: row.iteration,
    generationSeed: row.generation_seed,
    code: row.code,
    renderStatus: row.render_status,
    renderError: row.render_error,
    stlPath: row.stl_path,
    stepPath: row.step_path,
    threemfPath: row.threemf_path,
    screenshotFront: row.screenshot_front,
    screenshotTop: row.screenshot_top,
    screenshotIso: row.screenshot_iso,
    screenshotIsoBack: row.screenshot_iso_back,
    screenshotBottom: row.screenshot_bottom,
    evalScore: row.eval_score,
    evalIssues: parseJsonbArray(row.eval_issues),
    evalSuggestions: parseJsonbArray(row.eval_suggestions),
    approvalStatus: row.approval_status,
    rejectionNote: row.rejection_note,
    llmModel: row.llm_model,
    vlmModel: row.vlm_model,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

// ── Get single example ───────────────────────────────────────────────

export async function getExample(exampleId: string): Promise<ExampleDetail> {
  const result = await pool.query<ExampleRow>(
    `SELECT
       e.*,
       p.prompt AS prompt_text,
       c.name AS category_name,
       c.complexity
     FROM workbench_examples e
     JOIN workbench_example_prompts p ON p.id = e.prompt_id
     JOIN workbench_categories c ON c.id = p.category_id
     WHERE e.id = $1`,
    [exampleId],
  );

  if (result.rows.length === 0) {
    throw new WorkbenchSeederError("Example not found", 404);
  }

  const row = result.rows[0];
  return {
    id: row.id,
    promptId: row.prompt_id,
    promptText: row.prompt_text ?? "",
    categoryName: row.category_name ?? "",
    complexity: row.complexity ?? 1,
    iteration: row.iteration,
    generationSeed: row.generation_seed,
    code: row.code,
    renderStatus: row.render_status,
    renderError: row.render_error,
    stlPath: row.stl_path,
    stepPath: row.step_path,
    threemfPath: row.threemf_path,
    screenshotFront: row.screenshot_front,
    screenshotTop: row.screenshot_top,
    screenshotIso: row.screenshot_iso,
    screenshotIsoBack: row.screenshot_iso_back,
    screenshotBottom: row.screenshot_bottom,
    evalScore: row.eval_score,
    evalIssues: parseJsonbArray(row.eval_issues),
    evalSuggestions: parseJsonbArray(row.eval_suggestions),
    approvalStatus: row.approval_status,
    rejectionNote: row.rejection_note,
    llmModel: row.llm_model,
    vlmModel: row.vlm_model,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Approve ──────────────────────────────────────────────────────────

export async function approveExample(exampleId: string): Promise<void> {
  const result = await pool.query(
    `UPDATE workbench_examples
     SET approval_status = 'human_approved', rejection_note = NULL, updated_at = NOW()
     WHERE id = $1 AND approval_status IN ('pending', 'auto_approved', 'rejected')
     RETURNING id`,
    [exampleId],
  );

  if (result.rowCount === 0) {
    // Check if it exists at all
    const check = await pool.query("SELECT id, approval_status FROM workbench_examples WHERE id = $1", [exampleId]);
    if (check.rows.length === 0) {
      throw new WorkbenchSeederError("Example not found", 404);
    }
    throw new WorkbenchSeederError(
      `Cannot approve example with status '${check.rows[0].approval_status}'`,
      400,
    );
  }
}

// ── Reject ───────────────────────────────────────────────────────────

export async function rejectExample(exampleId: string, note?: string): Promise<void> {
  const result = await pool.query(
    `UPDATE workbench_examples
     SET approval_status = 'rejected', rejection_note = $2, updated_at = NOW()
     WHERE id = $1 AND approval_status IN ('pending', 'auto_approved', 'human_approved')
     RETURNING id`,
    [exampleId, note ?? null],
  );

  if (result.rowCount === 0) {
    const check = await pool.query("SELECT id, approval_status FROM workbench_examples WHERE id = $1", [exampleId]);
    if (check.rows.length === 0) {
      throw new WorkbenchSeederError("Example not found", 404);
    }
    throw new WorkbenchSeederError(
      `Cannot reject example with status '${check.rows[0].approval_status}'`,
      400,
    );
  }
}

// ── Edit code ────────────────────────────────────────────────────────

export async function updateExampleCode(exampleId: string, newCode: string): Promise<void> {
  if (!newCode || newCode.trim().length === 0) {
    throw new WorkbenchSeederError("Code cannot be empty", 400);
  }

  const result = await pool.query(
    `UPDATE workbench_examples
     SET code = $2,
         render_status = 'pending',
         render_error = NULL,
         screenshot_front = NULL,
         screenshot_top = NULL,
         screenshot_iso = NULL,
         screenshot_iso_back = NULL,
         screenshot_bottom = NULL,
         eval_score = NULL,
         eval_issues = NULL,
         eval_suggestions = NULL,
         approval_status = 'pending',
         updated_at = NOW()
     WHERE id = $1
     RETURNING id`,
    [exampleId, newCode.trim()],
  );

  if (result.rowCount === 0) {
    throw new WorkbenchSeederError("Example not found", 404);
  }
}

// ── Delete ──────────────────────────────────────────────────────────

export async function deleteExample(exampleId: string): Promise<void> {
  const result = await pool.query(
    `DELETE FROM workbench_examples WHERE id = $1 RETURNING id`,
    [exampleId],
  );
  if (result.rowCount === 0) {
    throw new WorkbenchSeederError("Example not found", 404);
  }
}

export async function deleteExamplesForPrompt(promptId: string): Promise<{ deleted: number }> {
  const result = await pool.query(
    `DELETE FROM workbench_examples WHERE prompt_id = $1`,
    [promptId],
  );
  return { deleted: result.rowCount ?? 0 };
}

export async function deleteExamplesForCategory(categoryId: string): Promise<{ deleted: number }> {
  const result = await pool.query(
    `DELETE FROM workbench_examples
     WHERE prompt_id IN (
       SELECT id FROM workbench_example_prompts WHERE category_id = $1
     )`,
    [categoryId],
  );
  return { deleted: result.rowCount ?? 0 };
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
  const result = await pool.query<CategoryStatRow>(`
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
  `);

  const categories = result.rows.map((row) => ({
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

interface ApprovedExampleRow {
  prompt: string;
  code: string;
  system_prompt_content: string;
}

export async function exportApprovedJsonl(): Promise<string> {
  // Get the active system prompt content
  const spResult = await pool.query<{ content: string }>(
    "SELECT content FROM workbench_system_prompts WHERE is_active = TRUE LIMIT 1",
  );
  const systemPromptContent = spResult.rows[0]?.content ?? "";

  // Fetch all approved examples with their prompt text
  const result = await pool.query<ApprovedExampleRow>(`
    SELECT
      p.prompt,
      e.code,
      $1::text AS system_prompt_content
    FROM workbench_examples e
    JOIN workbench_example_prompts p ON p.id = e.prompt_id
    WHERE e.approval_status IN ('auto_approved', 'human_approved')
      AND e.render_status = 'success'
    ORDER BY p.category_id, p.index, e.eval_score DESC
  `, [systemPromptContent]);

  const lines = result.rows.map((row) => {
    const record = {
      conversations: [
        { from: "system", value: row.system_prompt_content },
        { from: "human", value: row.prompt },
        { from: "gpt", value: `\`\`\`python\n${row.code}\n\`\`\`` },
      ],
    };
    return JSON.stringify(record);
  });

  return lines.join("\n");
}
