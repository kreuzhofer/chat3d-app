/**
 * One-shot backfill: re-classify historical render errors that were persisted
 * as the lossy literal "Agent codegen failed to render".
 *
 * Sources, in priority order:
 *   1. agentConversation — parse the last validate_and_render/render_project failure
 *   2. The row's own render_error — if it's NOT the lossy literal
 *
 * Outputs counts per workbench category. Idempotent: skips rows where
 * render_error_category is already set.
 *
 * CLI:
 *   npx tsx scripts/backfill-render-errors.ts --dry-run
 *   npx tsx scripts/backfill-render-errors.ts --commit
 *   npx tsx scripts/backfill-render-errors.ts --commit --category <uuid>
 *   npx tsx scripts/backfill-render-errors.ts --dry-run --limit 50
 */
import { prisma } from "../src/db/prisma.js";
import { createLogger } from "../src/utils/logger.js";
import { extractAndClassifyLastRenderError } from "../src/utils/render-error-extraction.js";
import { classifyRenderError, RenderErrorCategory } from "../src/utils/render-errors.js";

const logger = createLogger("backfill-render-errors");
const LOSSY_LITERAL = "Agent codegen failed to render";

export interface BackfillOptions {
  dryRun: boolean;
  categoryId?: string;
  limit?: number;
}

export interface BackfillReport {
  recovered_from_conversation: number;
  recovered_from_render_error: number;
  still_unknown: number;
  parse_errors: number;
  per_category: Record<string, number>; // category id → updated count
  by_classification: Record<string, number>; // RenderErrorCategory → count
}

export async function runBackfill(opts: BackfillOptions): Promise<BackfillReport> {
  const report: BackfillReport = {
    recovered_from_conversation: 0,
    recovered_from_render_error: 0,
    still_unknown: 0,
    parse_errors: 0,
    per_category: {},
    by_classification: {},
  };

  const where = {
    renderStatus: "error",
    renderErrorCategory: null as null,
    ...(opts.categoryId
      ? { promptRef: { categoryId: opts.categoryId } }
      : {}),
  };

  const rows = await prisma.workbenchExample.findMany({
    where,
    select: {
      id: true,
      renderError: true,
      agentConversation: true,
      promptRef: { select: { categoryId: true } },
    },
    take: opts.limit,
  });

  logger.info({ candidates: rows.length, opts }, "backfill candidates loaded");

  for (const row of rows) {
    let classified;
    let source: "conversation" | "render_error" | "none" = "none";

    try {
      classified = extractAndClassifyLastRenderError(row.agentConversation);
      if (classified) source = "conversation";
    } catch (err) {
      logger.warn({ rowId: row.id, err: err instanceof Error ? err.message : String(err) }, "agentConversation parse error");
      report.parse_errors++;
    }

    if (!classified && row.renderError && row.renderError !== LOSSY_LITERAL) {
      classified = classifyRenderError(row.renderError);
      source = "render_error";
    }

    if (!classified) {
      report.still_unknown++;
      if (!opts.dryRun) {
        await prisma.workbenchExample.update({
          where: { id: row.id },
          data: { renderErrorCategory: RenderErrorCategory.UNKNOWN },
        });
      }
      const catKey = row.promptRef.categoryId;
      report.per_category[catKey] = (report.per_category[catKey] ?? 0) + 1;
      report.by_classification[RenderErrorCategory.UNKNOWN] =
        (report.by_classification[RenderErrorCategory.UNKNOWN] ?? 0) + 1;
      continue;
    }

    if (source === "conversation") report.recovered_from_conversation++;
    else if (source === "render_error") report.recovered_from_render_error++;

    const catKey = row.promptRef.categoryId;
    report.per_category[catKey] = (report.per_category[catKey] ?? 0) + 1;
    report.by_classification[classified.category] =
      (report.by_classification[classified.category] ?? 0) + 1;

    if (!opts.dryRun) {
      await prisma.workbenchExample.update({
        where: { id: row.id },
        data: {
          renderErrorCategory: classified.category,
          renderErrorDetail: classified.capturedDetail,
          // Replace lossy literal with the recovered raw message; otherwise leave existing renderError alone.
          renderError: row.renderError === LOSSY_LITERAL ? classified.rawMessage : row.renderError,
        },
      });
    }
  }

  logger.info({ report }, "backfill complete");
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--commit");
  const categoryArgIdx = args.indexOf("--category");
  const categoryId = categoryArgIdx >= 0 ? args[categoryArgIdx + 1] : undefined;
  const limitArgIdx = args.indexOf("--limit");
  const limit = limitArgIdx >= 0 ? parseInt(args[limitArgIdx + 1], 10) : undefined;

  const report = await runBackfill({ dryRun, categoryId, limit });
  console.log("\n=== Backfill report ===");
  console.log(JSON.stringify(report, null, 2));
  if (dryRun) {
    console.log("\n(dry-run — re-run with --commit to apply)");
  }
  await prisma.$disconnect();
}

// Run main only when executed directly (not when imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
