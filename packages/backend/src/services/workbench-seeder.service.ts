import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { pool } from "../db/connection.js";
import { config } from "../config.js";
import { embedAndStorePrompt } from "./workbench-embeddings.service.js";

export class WorkbenchSeederError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

// ── Frontmatter + prompt parsing ──────────────────────────────────────

interface CategoryFrontmatter {
  rank: number;
  name: string;
  complexity: number;
  description: string;
}

interface ParsedCategoryFile {
  frontmatter: CategoryFrontmatter;
  prompts: string[];
}

function parseFrontmatter(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  let currentKey = "";
  let currentValue = "";

  for (const line of raw.split("\n")) {
    const keyMatch = line.match(/^(\w+):\s*(.*)/);
    if (keyMatch) {
      if (currentKey) {
        result[currentKey] = currentValue.trim();
      }
      currentKey = keyMatch[1];
      currentValue = keyMatch[2].replace(/^>\s*/, "");
    } else if (currentKey && line.match(/^\s+/)) {
      currentValue += " " + line.trim();
    }
  }
  if (currentKey) {
    result[currentKey] = currentValue.trim();
  }
  return result;
}

function parseCategoryFile(content: string, filename: string): ParsedCategoryFile {
  // Split frontmatter from body
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    throw new WorkbenchSeederError(`Invalid frontmatter in ${filename}`);
  }

  const raw = parseFrontmatter(fmMatch[1]);
  const rank = Number(raw.rank);
  const complexity = Number(raw.complexity);

  if (!Number.isInteger(rank) || rank < 1) {
    throw new WorkbenchSeederError(`Invalid rank in ${filename}: ${raw.rank}`);
  }
  if (!Number.isInteger(complexity) || complexity < 1 || complexity > 10) {
    throw new WorkbenchSeederError(`Invalid complexity in ${filename}: ${raw.complexity}`);
  }
  if (!raw.name) {
    throw new WorkbenchSeederError(`Missing name in ${filename}`);
  }
  if (!raw.description) {
    throw new WorkbenchSeederError(`Missing description in ${filename}`);
  }

  const frontmatter: CategoryFrontmatter = {
    rank,
    name: raw.name,
    complexity,
    description: raw.description,
  };

  // Parse numbered prompts: lines starting with "N. "
  const body = fmMatch[2];
  const prompts: string[] = [];
  let currentPrompt = "";
  let currentIndex = 0;

  for (const line of body.split("\n")) {
    const promptMatch = line.match(/^(\d+)\.\s+(.*)/);
    if (promptMatch) {
      // Save previous prompt if any
      if (currentIndex > 0 && currentPrompt) {
        prompts.push(currentPrompt.trim());
      }
      currentIndex = Number(promptMatch[1]);
      currentPrompt = promptMatch[2];
    } else if (currentIndex > 0 && line.match(/^\s+/) && line.trim().length > 0) {
      // Continuation line (indented)
      currentPrompt += " " + line.trim();
    }
  }
  // Save last prompt
  if (currentIndex > 0 && currentPrompt) {
    prompts.push(currentPrompt.trim());
  }

  return { frontmatter, prompts };
}

// ── Seeding ───────────────────────────────────────────────────────────

export interface SeedResult {
  categories: number;
  prompts: number;
  systemPromptSeeded: boolean;
}

export async function seedFromFiles(): Promise<SeedResult> {
  const categoriesDir = join(config.workbench.dataDir, "categories");
  const systemPromptPath = join(config.workbench.dataDir, "system-prompt.md");

  if (!existsSync(categoriesDir)) {
    throw new WorkbenchSeederError(
      `Categories directory not found: ${categoriesDir}`,
      404,
    );
  }

  const files = readdirSync(categoriesDir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  if (files.length === 0) {
    throw new WorkbenchSeederError("No category files found");
  }

  // Parse all files first (fail fast on any parse error)
  const parsed = files.map((filename) => {
    const content = readFileSync(join(categoriesDir, filename), "utf-8");
    return { filename, ...parseCategoryFile(content, filename) };
  });

  const client = await pool.connect();
  let totalPrompts = 0;

  try {
    await client.query("BEGIN");

    // Clear existing data (idempotent re-seed)
    await client.query("DELETE FROM workbench_example_prompts");
    await client.query("DELETE FROM workbench_categories");

    for (const { filename, frontmatter, prompts } of parsed) {
      // Insert category
      const catResult = await client.query<{ id: string }>(
        `INSERT INTO workbench_categories (rank, name, complexity, description)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [frontmatter.rank, frontmatter.name, frontmatter.complexity, frontmatter.description],
      );
      const categoryId = catResult.rows[0].id;

      // Insert prompts
      for (let i = 0; i < prompts.length; i++) {
        await client.query(
          `INSERT INTO workbench_example_prompts (category_id, index, prompt)
           VALUES ($1, $2, $3)`,
          [categoryId, i + 1, prompts[i]],
        );
      }

      totalPrompts += prompts.length;
      console.log(
        `  Seeded category ${frontmatter.rank}: ${frontmatter.name} — ${prompts.length} prompts (${filename})`,
      );
    }

    // Seed system prompt if file exists and no version exists yet
    let systemPromptSeeded = false;
    if (existsSync(systemPromptPath)) {
      const existing = await client.query(
        "SELECT COUNT(*) AS count FROM workbench_system_prompts",
      );
      if (Number(existing.rows[0].count) === 0) {
        const content = readFileSync(systemPromptPath, "utf-8");
        await client.query(
          `INSERT INTO workbench_system_prompts (version, label, content, is_active)
           VALUES (1, $1, $2, TRUE)`,
          ["Initial system prompt", content],
        );
        systemPromptSeeded = true;
        console.log("  Seeded system prompt v1 (active)");
      }
    }

    await client.query("COMMIT");

    return {
      categories: parsed.length,
      prompts: totalPrompts,
      systemPromptSeeded,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
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
  created_at: Date;
  updated_at: Date;
}

export async function listCategories() {
  // Count prompts that have at least one example with a given status.
  // This avoids inflated counts when a single prompt has multiple examples.
  const result = await pool.query<CategoryRow>(`
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
      c.created_at,
      c.updated_at
    FROM workbench_categories c
    LEFT JOIN workbench_example_prompts p ON p.category_id = c.id
    LEFT JOIN workbench_examples e ON e.prompt_id = p.id
    GROUP BY c.id
    ORDER BY c.rank
  `);

  return result.rows.map((row) => ({
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
  created_at: Date;
}

export async function listPromptsForCategory(categoryId: string) {
  // Verify category exists
  const catCheck = await pool.query(
    "SELECT id FROM workbench_categories WHERE id = $1",
    [categoryId],
  );
  if (catCheck.rows.length === 0) {
    throw new WorkbenchSeederError("Category not found", 404);
  }

  const result = await pool.query<PromptRow>(`
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
      p.created_at
    FROM workbench_example_prompts p
    LEFT JOIN workbench_examples e ON e.prompt_id = p.id
    WHERE p.category_id = $1
    GROUP BY p.id
    ORDER BY p.index
  `, [categoryId]);

  return result.rows.map((row) => ({
    id: row.id,
    categoryId: row.category_id,
    index: row.index,
    prompt: row.prompt,
    exampleCount: Number(row.example_count),
    bestScore: row.best_score,
    bestApproval: row.best_approval,
    createdAt: row.created_at,
  }));
}

export async function updatePromptText(promptId: string, newText: string): Promise<void> {
  if (!newText || newText.trim().length === 0) {
    throw new WorkbenchSeederError("Prompt text cannot be empty", 400);
  }

  const trimmed = newText.trim();

  // Clear embedding so it gets re-generated
  const result = await pool.query(
    `UPDATE workbench_example_prompts SET prompt = $2, embedding = NULL WHERE id = $1 RETURNING id`,
    [promptId, trimmed],
  );

  if (result.rowCount === 0) {
    throw new WorkbenchSeederError("Prompt not found", 404);
  }

  // Re-embed asynchronously
  void embedAndStorePrompt(promptId, trimmed).catch((err) =>
    console.warn(`[workbench] failed to re-embed prompt ${promptId}: ${err}`),
  );
}

// ── System prompt CRUD ────────────────────────────────────────────────

interface SystemPromptRow {
  id: string;
  version: number;
  label: string;
  content: string;
  is_active: boolean;
  created_at: Date;
}

export async function listSystemPrompts() {
  const result = await pool.query<SystemPromptRow>(
    "SELECT id, version, label, content, is_active, created_at FROM workbench_system_prompts ORDER BY version DESC",
  );

  return result.rows.map((row) => ({
    id: row.id,
    version: row.version,
    label: row.label,
    content: row.content,
    isActive: row.is_active,
    createdAt: row.created_at,
  }));
}

export async function getActiveSystemPrompt() {
  const result = await pool.query<SystemPromptRow>(
    "SELECT id, version, label, content, is_active, created_at FROM workbench_system_prompts WHERE is_active = TRUE LIMIT 1",
  );

  if (result.rows.length === 0) {
    throw new WorkbenchSeederError("No active system prompt found", 404);
  }

  const row = result.rows[0];
  return {
    id: row.id,
    version: row.version,
    label: row.label,
    content: row.content,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export async function activateSystemPrompt(promptId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Verify prompt exists
    const check = await client.query(
      "SELECT id FROM workbench_system_prompts WHERE id = $1",
      [promptId],
    );
    if (check.rows.length === 0) {
      throw new WorkbenchSeederError("System prompt not found", 404);
    }

    // Deactivate all, then activate the target
    await client.query("UPDATE workbench_system_prompts SET is_active = FALSE");
    await client.query(
      "UPDATE workbench_system_prompts SET is_active = TRUE WHERE id = $1",
      [promptId],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
