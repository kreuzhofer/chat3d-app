/**
 * Per-category render-error analytics. Powers the Render Errors admin tab
 * and the /api/admin/data-quality histogram extension.
 */
import { prisma } from "../db/prisma.js";
import { RenderErrorCategory } from "../utils/render-errors.js";

export type RenderErrorHistogram = Record<
  | "infrastructure" | "api_misuse" | "geometry" | "type_error"
  | "kernel_error" | "syntax" | "unknown",
  number
>;

const EMPTY_HISTOGRAM = (): RenderErrorHistogram => ({
  infrastructure: 0,
  api_misuse: 0,
  geometry: 0,
  type_error: 0,
  kernel_error: 0,
  syntax: 0,
  unknown: 0,
});

export async function getRenderErrorHistogramForCategory(
  categoryId: string,
): Promise<RenderErrorHistogram> {
  const rows = await prisma.$queryRaw<Array<{ category: string | null; count: bigint }>>`
    SELECT we.render_error_category AS category, COUNT(*)::bigint AS count
    FROM workbench_examples we
    JOIN workbench_example_prompts wep ON wep.id = we.prompt_id
    WHERE wep.category_id = ${categoryId}::uuid
      AND we.render_status = 'error'
      AND we.render_error_category IS NOT NULL
    GROUP BY we.render_error_category
  `;

  const result = EMPTY_HISTOGRAM();
  for (const r of rows) {
    if (r.category && r.category in result) {
      (result as Record<string, number>)[r.category] = Number(r.count);
    }
  }
  return result;
}

export interface RenderErrorExample {
  id: string;
  promptId: string;
  promptText: string;
  renderError: string | null;
  renderErrorDetail: string | null;
  renderErrorCategory: string;
  createdAt: Date;
}

export interface ListExamplesParams {
  categoryId: string;
  errorCategory: string;
  limit: number;
  offset?: number;
}

export async function listExamplesByRenderErrorCategory(
  params: ListExamplesParams,
): Promise<{ examples: RenderErrorExample[]; total: number }> {
  const { categoryId, errorCategory, limit, offset = 0 } = params;

  const validCategories = Object.values(RenderErrorCategory) as string[];
  if (!validCategories.includes(errorCategory)) {
    throw new Error(`Invalid errorCategory: ${errorCategory}`);
  }

  const [examples, total] = await Promise.all([
    prisma.workbenchExample.findMany({
      where: {
        renderStatus: "error",
        renderErrorCategory: errorCategory,
        promptRef: { categoryId },
      },
      select: {
        id: true,
        promptId: true,
        renderError: true,
        renderErrorDetail: true,
        renderErrorCategory: true,
        createdAt: true,
        promptRef: { select: { prompt: true } },
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 200),
      skip: offset,
    }),
    prisma.workbenchExample.count({
      where: {
        renderStatus: "error",
        renderErrorCategory: errorCategory,
        promptRef: { categoryId },
      },
    }),
  ]);

  return {
    examples: examples.map((e) => ({
      id: e.id,
      promptId: e.promptId,
      promptText: e.promptRef.prompt,
      renderError: e.renderError,
      renderErrorDetail: e.renderErrorDetail,
      renderErrorCategory: e.renderErrorCategory ?? "unknown",
      createdAt: e.createdAt,
    })),
    total,
  };
}
