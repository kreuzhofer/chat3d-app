/**
 * Delete workbench categories whose names carry the generated test suffix
 * `-<epoch-ms>-<rank>` (see NAME_PATTERN). Never matches a hand-named category.
 *
 * Dry-run mode (default): prints matched categories with prompt/example/file counts.
 * Commit mode (--commit):  calls DELETE /api/admin/workbench/categories/:id for each match,
 *                          accumulating a final deletion report.
 *
 * Auth: reads token from /tmp/chat3d-token.txt; re-logs in if absent/expired.
 */
import { promises as fs } from "node:fs";
import { prisma } from "../src/db/prisma.js";
import { createLogger } from "../src/utils/logger.js";
import {
  collectFilePaths,
  type CleanupExampleRow,
} from "../src/services/workbench-examples.service.js";

const logger = createLogger("delete-test-categories");

/**
 * Matches only the machine-generated suffix the seeding tests produce —
 * `<prefix>-<epoch-ms>-<rank>`, e.g. `backfill-test-1788174868921-456`.
 *
 * Deliberately structural rather than a substring match on "test": the previous
 * /test/i pattern both missed 54 generated categories whose prefix happens not
 * to contain "test", and would have matched any human-named category with
 * "test" in it. A real category name cannot end in `-<13 digits>-<n>`.
 */
const NAME_PATTERN = /-\d{10,}-\d+$/;
const API_BASE = process.env.API_BASE_URL ?? "http://localhost";
const TOKEN_PATH = "/tmp/chat3d-token.txt";
const ADMIN_EMAIL = "admin@chat3d.local";
const ADMIN_PASSWORD = "change-admin-password";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CategorySummary {
  id: string;
  name: string;
  promptCount: number;
  exampleCount: number;
  fileCount: number;
}

interface FailedDelete {
  id: string;
  name: string;
  error: string;
}

interface DeleteReport {
  matchedCount: number;
  categories: CategorySummary[];
  totalPrompts: number;
  totalExamples: number;
  totalFiles: number;
  successfulDeletes: number;
  failedDeletes: FailedDelete[];
  totalDeletedPrompts: number;
  totalDeletedExamples: number;
  totalFilesDeleted: number;
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

async function getToken(): Promise<string> {
  // Try cached token first
  try {
    const tok = (await fs.readFile(TOKEN_PATH, "utf8")).trim();
    const r = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    if (r.ok) return tok;
    logger.debug("cached token expired, re-logging in");
  } catch {
    logger.debug("no cached token found, logging in");
  }

  // Fresh login
  const r = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`login failed: ${r.status} ${text.slice(0, 200)}`);
  }
  const body = (await r.json()) as { token: string };
  await fs.writeFile(TOKEN_PATH, body.token);
  logger.debug("logged in and cached token");
  return body.token;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function findMatchingCategories(): Promise<{ id: string; name: string }[]> {
  const all = await prisma.workbenchCategory.findMany({
    select: { id: true, name: true },
  });
  return all.filter((c) => NAME_PATTERN.test(c.name));
}

async function summarizeCategory(
  categoryId: string,
  categoryName: string,
): Promise<CategorySummary> {
  const prompts = await prisma.workbenchExamplePrompt.findMany({
    where: { categoryId },
    select: { id: true },
  });

  if (prompts.length === 0) {
    return {
      id: categoryId,
      name: categoryName,
      promptCount: 0,
      exampleCount: 0,
      fileCount: 0,
    };
  }

  const rows = await prisma.$queryRaw<CleanupExampleRow[]>`
    SELECT e.id, e.stl_path, e.step_path, e.threemf_path,
           e.screenshot_front, e.screenshot_back, e.screenshot_left, e.screenshot_right,
           e.screenshot_top, e.screenshot_bottom, e.screenshot_ortho_45, e.screenshot_ortho_45_bottom,
           e.screenshot_iso, e.screenshot_iso_back,
           p.category_id, e.approval_status, e.eval_score, e.created_at,
           (e.agent_conversation IS NOT NULL) AS has_agent_trace
    FROM workbench_examples e
    JOIN workbench_example_prompts p ON p.id = e.prompt_id
    WHERE p.category_id = ${categoryId}::uuid AND e.experiment_run_id IS NULL
  `;

  const fileCount = rows.flatMap(collectFilePaths).length;

  return {
    id: categoryId,
    name: categoryName,
    promptCount: prompts.length,
    exampleCount: rows.length,
    fileCount,
  };
}

// ── Core logic ────────────────────────────────────────────────────────────────

export async function deleteTestCategories(commit: boolean): Promise<DeleteReport> {
  const matches = await findMatchingCategories();
  logger.info({ count: matches.length }, "found candidate test categories");

  // Summarize all matched categories
  const summaries: CategorySummary[] = [];
  for (const m of matches) {
    summaries.push(await summarizeCategory(m.id, m.name));
  }

  const totalPrompts = summaries.reduce((s, c) => s + c.promptCount, 0);
  const totalExamples = summaries.reduce((s, c) => s + c.exampleCount, 0);
  const totalFiles = summaries.reduce((s, c) => s + c.fileCount, 0);

  if (!commit) {
    return {
      matchedCount: matches.length,
      categories: summaries.slice(0, 30),
      totalPrompts,
      totalExamples,
      totalFiles,
      successfulDeletes: 0,
      failedDeletes: [],
      totalDeletedPrompts: 0,
      totalDeletedExamples: 0,
      totalFilesDeleted: 0,
    };
  }

  // Commit mode: delete via API
  const token = await getToken();
  let okCount = 0;
  const failed: FailedDelete[] = [];
  let deletedPrompts = 0;
  let deletedExamples = 0;
  let filesDeleted = 0;

  for (const cat of matches) {
    try {
      const r = await fetch(`${API_BASE}/api/admin/workbench/categories/${cat.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        const text = await r.text();
        failed.push({
          id: cat.id,
          name: cat.name,
          error: `HTTP ${r.status}: ${text.slice(0, 200)}`,
        });
        logger.warn({ id: cat.id, name: cat.name, status: r.status }, "delete failed");
        continue;
      }
      const body = (await r.json()) as {
        ok: boolean;
        deletedPrompts: number;
        deletedExamples: number;
        filesDeleted: number;
      };
      okCount += 1;
      deletedPrompts += body.deletedPrompts ?? 0;
      deletedExamples += body.deletedExamples ?? 0;
      filesDeleted += body.filesDeleted ?? 0;
      logger.debug({ id: cat.id, name: cat.name, ...body }, "category deleted");

      if (okCount % 20 === 0) {
        logger.info(
          { ok: okCount, remaining: matches.length - okCount - failed.length },
          "progress",
        );
      }
    } catch (err) {
      failed.push({ id: cat.id, name: cat.name, error: String(err) });
      logger.warn({ id: cat.id, name: cat.name, err }, "delete threw error");
    }
  }

  logger.info(
    { ok: okCount, failed: failed.length, deletedPrompts, deletedExamples, filesDeleted },
    "delete-test-categories complete",
  );

  return {
    matchedCount: matches.length,
    categories: summaries.slice(0, 30),
    totalPrompts,
    totalExamples,
    totalFiles,
    successfulDeletes: okCount,
    failedDeletes: failed,
    totalDeletedPrompts: deletedPrompts,
    totalDeletedExamples: deletedExamples,
    totalFilesDeleted: filesDeleted,
  };
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  const commit = process.argv.includes("--commit");

  if (!commit) {
    logger.warn("DRY-RUN mode — pass --commit to actually delete");
  } else {
    logger.warn("COMMIT mode — categories will be permanently deleted");
  }

  const report = await deleteTestCategories(commit);

  logger.info(
    {
      matchedCount: report.matchedCount,
      totalPrompts: report.totalPrompts,
      totalExamples: report.totalExamples,
      totalFiles: report.totalFiles,
    },
    commit ? "delete-test-categories report" : "dry-run report",
  );

  if (report.categories.length > 0) {
    logger.info(
      { sample: report.categories.slice(0, 10) },
      `sample of matched categories (showing up to 10 of ${report.matchedCount})`,
    );
  }

  if (commit) {
    logger.info(
      {
        successfulDeletes: report.successfulDeletes,
        failedDeletes: report.failedDeletes.length,
        totalDeletedPrompts: report.totalDeletedPrompts,
        totalDeletedExamples: report.totalDeletedExamples,
        totalFilesDeleted: report.totalFilesDeleted,
      },
      "commit results",
    );
    if (report.failedDeletes.length > 0) {
      logger.warn(
        { failures: report.failedDeletes.slice(0, 20) },
        "failed deletes",
      );
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  logger.error({ err }, "delete-test-categories failed");
  process.exit(1);
});
