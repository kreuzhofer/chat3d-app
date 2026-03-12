/**
 * Gallery Service
 *
 * Public-facing gallery data access: category browsing, model listing,
 * vector search, and remix functionality.
 */

import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import { embedPromptText } from "./workbench-embeddings.service.js";
import { createChatContext, createChatItem } from "./chat.service.js";
import {
  readStorageFile,
  writeStorageFileFromBuffer,
  FileStorageError,
} from "./file-storage.service.js";
import type {
  GalleryCategory,
  GalleryModelSummary,
  GalleryModelDetail,
  GallerySearchResult,
  PaginatedResult,
} from "@chat3d/shared";

const logger = createLogger("gallery");

export class GalleryServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

// ── Constants ────────────────────────────────────────────────────────

const APPROVED_STATUSES = ["auto_approved", "human_approved"];
const MAX_PAGE_SIZE = 50;

function clampPageSize(raw: number): number {
  return Math.min(Math.max(1, Math.floor(raw)), MAX_PAGE_SIZE);
}

function clampPage(raw: number): number {
  return Math.max(1, Math.floor(raw));
}

// ── Category listing ────────────────────────────────────────────────

interface CategoryRow {
  id: string;
  name: string;
  description: string;
  complexity: number;
  rank: number;
  model_count: string;
}

interface HeroRow {
  id: string;
  prompt_text: string;
  category_name: string;
  category_id: string;
  eval_score: number | null;
  created_at: Date;
}

export async function listGalleryCategories(
  rawPage = 1,
  rawPageSize = 20,
): Promise<PaginatedResult<GalleryCategory>> {
  const page = clampPage(rawPage);
  const pageSize = clampPageSize(rawPageSize);
  const offset = (page - 1) * pageSize;

  // Count total categories that have at least one approved model
  const countRows = await prisma.$queryRaw<{ cnt: string }[]>`
    SELECT COUNT(DISTINCT c.id)::text AS cnt
    FROM workbench_categories c
    JOIN workbench_example_prompts p ON p.category_id = c.id
    JOIN workbench_examples e ON e.prompt_id = p.id
    WHERE e.approval_status IN ('auto_approved', 'human_approved')
      AND e.render_status = 'success'
      AND e.screenshot_iso IS NOT NULL
  `;
  const total = Number(countRows[0]?.cnt ?? 0);

  // Fetch categories with model counts
  const categoryRows = await prisma.$queryRaw<CategoryRow[]>`
    SELECT c.id, c.name, c.description, c.complexity, c.rank,
           COUNT(e.id)::text AS model_count
    FROM workbench_categories c
    JOIN workbench_example_prompts p ON p.category_id = c.id
    JOIN workbench_examples e ON e.prompt_id = p.id
    WHERE e.approval_status IN ('auto_approved', 'human_approved')
      AND e.render_status = 'success'
      AND e.screenshot_iso IS NOT NULL
    GROUP BY c.id
    ORDER BY c.rank
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  // For each category, find top 4 preview models (featured first, then top-rated)
  const categories: GalleryCategory[] = [];
  for (const cat of categoryRows) {
    const previewRows = await prisma.$queryRaw<HeroRow[]>`
      SELECT e.id, p.prompt AS prompt_text, c.name AS category_name,
             c.id AS category_id, e.eval_score, e.created_at
      FROM workbench_examples e
      JOIN workbench_example_prompts p ON p.id = e.prompt_id
      JOIN workbench_categories c ON c.id = p.category_id
      WHERE p.category_id = ${cat.id}::uuid
        AND e.approval_status IN ('auto_approved', 'human_approved')
        AND e.render_status = 'success'
        AND e.screenshot_iso IS NOT NULL
      ORDER BY
        e.featured DESC,
        e.eval_score DESC NULLS LAST,
        e.created_at DESC
      LIMIT 4
    `;

    categories.push({
      id: cat.id,
      name: cat.name,
      description: cat.description,
      complexity: cat.complexity,
      rank: cat.rank,
      modelCount: Number(cat.model_count),
      previewModels: previewRows.map((r) => ({
        id: r.id,
        promptText: r.prompt_text,
        categoryName: r.category_name,
        categoryId: r.category_id,
        evalScore: r.eval_score,
        createdAt: r.created_at.toISOString(),
      })),
    });
  }

  return { items: categories, total, page, pageSize, hasMore: offset + pageSize < total };
}

// ── Models in a category ────────────────────────────────────────────

interface ModelRow {
  id: string;
  prompt_text: string;
  category_name: string;
  category_id: string;
  eval_score: number | null;
  created_at: Date;
}

export async function listGalleryModels(
  categoryId: string,
  rawPage = 1,
  rawPageSize = 20,
): Promise<PaginatedResult<GalleryModelSummary>> {
  const page = clampPage(rawPage);
  const pageSize = clampPageSize(rawPageSize);
  const offset = (page - 1) * pageSize;

  const countRows = await prisma.$queryRaw<{ cnt: string }[]>`
    SELECT COUNT(e.id)::text AS cnt
    FROM workbench_examples e
    JOIN workbench_example_prompts p ON p.id = e.prompt_id
    WHERE p.category_id = ${categoryId}::uuid
      AND e.approval_status IN ('auto_approved', 'human_approved')
      AND e.render_status = 'success'
      AND e.screenshot_iso IS NOT NULL
  `;
  const total = Number(countRows[0]?.cnt ?? 0);

  const rows = await prisma.$queryRaw<ModelRow[]>`
    SELECT e.id, p.prompt AS prompt_text, c.name AS category_name,
           c.id AS category_id, e.eval_score, e.created_at
    FROM workbench_examples e
    JOIN workbench_example_prompts p ON p.id = e.prompt_id
    JOIN workbench_categories c ON c.id = p.category_id
    WHERE p.category_id = ${categoryId}::uuid
      AND e.approval_status IN ('auto_approved', 'human_approved')
      AND e.render_status = 'success'
      AND e.screenshot_iso IS NOT NULL
    ORDER BY e.eval_score DESC NULLS LAST, e.created_at DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  const items: GalleryModelSummary[] = rows.map((r) => ({
    id: r.id,
    promptText: r.prompt_text,
    categoryName: r.category_name,
    categoryId: r.category_id,
    evalScore: r.eval_score,
    createdAt: r.created_at.toISOString(),
  }));

  return { items, total, page, pageSize, hasMore: offset + pageSize < total };
}

// ── Single model detail ─────────────────────────────────────────────

export async function getGalleryModel(exampleId: string): Promise<GalleryModelDetail> {
  const row = await prisma.workbenchExample.findFirst({
    where: {
      id: exampleId,
      approvalStatus: { in: APPROVED_STATUSES },
      renderStatus: "success",
    },
    include: { promptRef: { include: { category: true } } },
  });

  if (!row) {
    throw new GalleryServiceError("Model not found", 404);
  }

  return {
    id: row.id,
    promptText: row.promptRef.prompt,
    categoryName: row.promptRef.category.name,
    categoryId: row.promptRef.categoryId,
    evalScore: row.evalScore,
    createdAt: row.createdAt.toISOString(),
    code: row.code,
    stlPath: row.stlPath,
    stepPath: row.stepPath,
    threemfPath: row.threemfPath,
    screenshotIso: row.screenshotIso ? "available" : null,
    screenshotFront: row.screenshotFront ? "available" : null,
    screenshotOrtho45: row.screenshotOrtho45 ? "available" : null,
  };
}

// ── Vector search ───────────────────────────────────────────────────

interface SimilarityRow {
  id: string;
  prompt_text: string;
  category_name: string;
  category_id: string;
  eval_score: number | null;
  created_at: Date;
  similarity: number;
}

export async function searchGalleryModels(
  queryText: string,
  rawPage = 1,
  rawPageSize = 20,
): Promise<PaginatedResult<GallerySearchResult>> {
  const page = clampPage(rawPage);
  const pageSize = clampPageSize(rawPageSize);
  const offset = (page - 1) * pageSize;

  const queryEmbedding = await embedPromptText(queryText);
  const pgVector = `[${queryEmbedding.join(",")}]`;

  // Get total count of results above a similarity threshold
  const countRows = await prisma.$queryRaw<{ cnt: string }[]>`
    SELECT COUNT(*)::text AS cnt
    FROM workbench_examples e
    JOIN workbench_example_prompts p ON p.id = e.prompt_id
    WHERE p.embedding IS NOT NULL
      AND e.approval_status IN ('auto_approved', 'human_approved')
      AND e.render_status = 'success'
      AND e.screenshot_iso IS NOT NULL
      AND (1 - (p.embedding <=> ${pgVector}::vector)) > 0.3
  `;
  const total = Number(countRows[0]?.cnt ?? 0);

  const rows = await prisma.$queryRaw<SimilarityRow[]>`
    SELECT e.id, p.prompt AS prompt_text, c.name AS category_name,
           c.id AS category_id, e.eval_score, e.created_at,
           1 - (p.embedding <=> ${pgVector}::vector) AS similarity
    FROM workbench_examples e
    JOIN workbench_example_prompts p ON p.id = e.prompt_id
    JOIN workbench_categories c ON c.id = p.category_id
    WHERE p.embedding IS NOT NULL
      AND e.approval_status IN ('auto_approved', 'human_approved')
      AND e.render_status = 'success'
      AND e.screenshot_iso IS NOT NULL
      AND (1 - (p.embedding <=> ${pgVector}::vector)) > 0.3
    ORDER BY p.embedding <=> ${pgVector}::vector ASC
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  const items: GallerySearchResult[] = rows.map((r) => ({
    id: r.id,
    promptText: r.prompt_text,
    categoryName: r.category_name,
    categoryId: r.category_id,
    evalScore: r.eval_score,
    createdAt: r.created_at.toISOString(),
    similarity: Number(Number(r.similarity).toFixed(4)),
  }));

  return { items, total, page, pageSize, hasMore: offset + pageSize < total };
}

// ── Featured model management (admin) ───────────────────────────────

export async function setFeaturedExample(exampleId: string): Promise<void> {
  // Find the example and its category
  const example = await prisma.workbenchExample.findFirst({
    where: {
      id: exampleId,
      approvalStatus: { in: APPROVED_STATUSES },
      renderStatus: "success",
    },
    include: { promptRef: true },
  });

  if (!example) {
    throw new GalleryServiceError("Approved example not found", 404);
  }

  const categoryId = example.promptRef.categoryId;

  // Unset all featured in the same category, then set this one
  await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE workbench_examples
      SET featured = false
      FROM workbench_example_prompts p
      WHERE workbench_examples.prompt_id = p.id
        AND p.category_id = ${categoryId}::uuid
        AND workbench_examples.featured = true
    `,
    prisma.workbenchExample.update({
      where: { id: exampleId },
      data: { featured: true },
    }),
  ]);

  logger.info({ exampleId, categoryId }, "set featured example");
}

export async function clearFeaturedExample(categoryId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE workbench_examples
    SET featured = false
    FROM workbench_example_prompts p
    WHERE workbench_examples.prompt_id = p.id
      AND p.category_id = ${categoryId}::uuid
      AND workbench_examples.featured = true
  `;

  logger.info({ categoryId }, "cleared featured example for category");
}

// ── Model position (for deep-linking) ────────────────────────────────

export async function getModelPosition(
  modelId: string,
  rawPageSize = 20,
): Promise<{ categoryId: string; page: number; index: number }> {
  const pageSize = clampPageSize(rawPageSize);

  // Find the model and its category
  const example = await prisma.workbenchExample.findFirst({
    where: {
      id: modelId,
      approvalStatus: { in: ["auto_approved", "human_approved"] },
      renderStatus: "success",
      screenshotIso: { not: null },
    },
    include: { promptRef: { select: { categoryId: true } } },
  });

  if (!example) {
    throw new GalleryServiceError("Model not found", 404);
  }

  const categoryId = example.promptRef.categoryId;

  // Count how many models in this category rank above this one
  // using the same sort order as listGalleryModels: eval_score DESC NULLS LAST, created_at DESC
  const rankRows = await prisma.$queryRaw<{ rank: string }[]>`
    SELECT COUNT(*)::text AS rank
    FROM workbench_examples e
    JOIN workbench_example_prompts p ON p.id = e.prompt_id
    WHERE p.category_id = ${categoryId}::uuid
      AND e.approval_status IN ('auto_approved', 'human_approved')
      AND e.render_status = 'success'
      AND e.screenshot_iso IS NOT NULL
      AND (
        (e.eval_score IS NOT NULL AND ${example.evalScore}::numeric IS NOT NULL AND e.eval_score > ${example.evalScore}::numeric)
        OR (e.eval_score IS NOT NULL AND ${example.evalScore}::numeric IS NULL)
        OR (
          COALESCE(e.eval_score, -1) = COALESCE(${example.evalScore}::numeric, -1)
          AND e.created_at > ${example.createdAt}::timestamptz
        )
        OR (
          COALESCE(e.eval_score, -1) = COALESCE(${example.evalScore}::numeric, -1)
          AND e.created_at = ${example.createdAt}::timestamptz
          AND e.id < ${modelId}::uuid
        )
      )
  `;

  const rank = Number(rankRows[0]?.rank ?? 0);
  const page = Math.floor(rank / pageSize) + 1;
  const index = rank % pageSize;

  return { categoryId, page, index };
}

// ── Remix ───────────────────────────────────────────────────────────

export async function remixGalleryModel(input: {
  userId: string;
  exampleId: string;
}): Promise<{ contextId: string }> {
  // 1. Fetch the approved example
  const example = await prisma.workbenchExample.findFirst({
    where: {
      id: input.exampleId,
      approvalStatus: { in: APPROVED_STATUSES },
      renderStatus: "success",
    },
    include: { promptRef: { include: { category: true } } },
  });

  if (!example) {
    throw new GalleryServiceError("Model not found", 404);
  }

  // 2. Create chat context with lineage tracking
  const promptTruncated = example.promptRef.prompt.length > 60
    ? `${example.promptRef.prompt.slice(0, 57)}...`
    : example.promptRef.prompt;
  const context = await createChatContext({
    userId: input.userId,
    name: `Remix: ${promptTruncated}`,
    remixedFromPromptId: example.promptRef.id,
  });

  // 3. Copy workbench files to chat storage
  const fileCopies: Array<{ path: string; filename: string }> = [];

  const fileMappings: Array<{ srcPath: string | null; ext: string }> = [
    { srcPath: example.stlPath, ext: "stl" },
    { srcPath: example.stepPath, ext: "step" },
    { srcPath: example.threemfPath, ext: "3mf" },
  ];

  for (const { srcPath, ext } of fileMappings) {
    if (!srcPath) continue;
    try {
      const buffer = await readStorageFile({ relativePath: srcPath });
      const destPath = `chat/${context.id}/${context.id}.${ext}`;
      await writeStorageFileFromBuffer({ relativePath: destPath, content: buffer });
      fileCopies.push({ path: destPath, filename: `${context.id}.${ext}` });
    } catch (err) {
      if (err instanceof FileStorageError && err.statusCode === 404) {
        logger.warn({ srcPath, ext }, "remix: source file not found, skipping");
      } else {
        throw err;
      }
    }
  }

  // Copy b123d code as file
  if (example.code?.trim()) {
    const destPath = `chat/${context.id}/${context.id}.b123d`;
    await writeStorageFileFromBuffer({
      relativePath: destPath,
      content: Buffer.from(example.code, "utf-8"),
    });
    fileCopies.push({ path: destPath, filename: `${context.id}.b123d` });
  }

  // 4. Create user chat item with original prompt
  await createChatItem({
    userId: input.userId,
    contextId: context.id,
    role: "user",
    messages: [
      { itemType: "message", text: example.promptRef.prompt, state: "completed", stateMessage: "" },
    ],
  });

  // 5. Create assistant chat item with model result
  const previewFile = fileCopies.find(
    (f) => f.path.endsWith(".3mf") || f.path.endsWith(".stl"),
  );

  const assistantMessages: unknown[] = [
    {
      itemType: "message",
      text: "Here is the model from the gallery. You can modify it by describing what you'd like to change.",
      state: "completed",
      stateMessage: "",
    },
  ];

  if (fileCopies.length > 0) {
    assistantMessages.push({
      itemType: "3dmodel",
      text: previewFile ? "3D preview ready." : "Model files attached.",
      attachment: previewFile?.path ?? "",
      state: "completed",
      stateMessage: "",
      artifact: {
        previewStatus: previewFile ? "ready" : "downgraded",
        detail: previewFile
          ? "Preview-ready artifact available."
          : "Download files to view.",
        previewFilePath: previewFile?.path ?? null,
      },
      files: fileCopies,
      previews: [],
    });
  }

  if (example.code?.trim()) {
    assistantMessages.push({
      itemType: "code",
      text: example.code,
      state: "completed",
      stateMessage: "",
    });
  }

  await createChatItem({
    userId: input.userId,
    contextId: context.id,
    role: "assistant",
    messages: assistantMessages,
  });

  logger.info(
    { userId: input.userId, exampleId: input.exampleId, contextId: context.id, fileCount: fileCopies.length },
    "remixed gallery model into chat",
  );

  return { contextId: context.id };
}

// ── Starter prompts (onboarding) ────────────────────────────────────

interface StarterPromptRow {
  id: string;
  prompt_text: string;
  category_name: string;
  category_id: string;
  eval_score: number | null;
  featured: boolean;
}

export interface StarterPrompt {
  id: string;
  promptText: string;
  categoryName: string;
  categoryId: string;
  screenshotUrl: string;
}

/**
 * Returns up to `limit` gallery models suitable for onboarding starter prompts.
 * Featured (hand-picked) items come first, then top-rated from across categories.
 * Deduplicates by prompt text so users see variety.
 */
export async function listStarterPrompts(limit = 4): Promise<StarterPrompt[]> {
  // Use DISTINCT ON to pick one example per unique prompt, then re-sort by featured/score
  const rows = await prisma.$queryRaw<StarterPromptRow[]>`
    SELECT * FROM (
      SELECT DISTINCT ON (p.prompt)
             e.id, p.prompt AS prompt_text, c.name AS category_name,
             c.id AS category_id, e.eval_score, e.featured
      FROM workbench_examples e
      JOIN workbench_example_prompts p ON p.id = e.prompt_id
      JOIN workbench_categories c ON c.id = p.category_id
      WHERE e.approval_status IN ('auto_approved', 'human_approved')
        AND e.render_status = 'success'
        AND e.screenshot_iso IS NOT NULL
      ORDER BY p.prompt, e.featured DESC, e.eval_score DESC NULLS LAST
    ) deduped
    ORDER BY deduped.featured DESC, deduped.eval_score DESC NULLS LAST
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    id: r.id,
    promptText: r.prompt_text,
    categoryName: r.category_name,
    categoryId: r.category_id,
    screenshotUrl: `/api/public/gallery/models/${r.id}/screenshot`,
  }));
}
