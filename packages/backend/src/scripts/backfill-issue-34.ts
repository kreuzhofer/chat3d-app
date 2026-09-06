/**
 * Issue #34 — re-score the examples that were judged against a placeholder
 * checklist, and write the corrected scores back.
 *
 * Scope is deliberately the *visual* evaluation only, exactly as measured on
 * the 125-example sample: the code score, assertion pass rate and weights are
 * held at their stored values, so the visual score is the only input that
 * moves. Running the full pipeline instead would re-run code review on the
 * model currently mapped to `code_review` — the local Spark, not the Sonnet
 * that produced the stored code scores — which would change eval_score for a
 * reason unrelated to #33 and confound the correction it is meant to apply.
 *
 * Resumable by construction: a row stops matching the selection as soon as it
 * is rewritten (eval_checklist_state moves off "placeholder"), so re-running
 * after an interruption picks up exactly where it stopped.
 *
 * Rollback: workbench_examples_pre_issue34 holds the full pre-run rows.
 *
 * usage: tsx src/scripts/backfill-issue-34.ts <model_id> [limit]
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import { evaluateModelWithConfig, type LabeledImage } from "../services/visual-eval.service.js";
import { resolveModelConfigById } from "../services/llm-config.service.js";
import { readStorageFile, storageFileExists } from "../services/file-storage.service.js";
import { deriveVisualChecklist, toAnnotatedCriteria } from "../utils/verification-criteria.js";
import { classifyChecklist } from "../utils/checklist-state.js";
import { parseEvalPlan } from "../utils/eval-plan.js";
import {
  computeCompositeScore,
  resolveCodeEvalWeight,
} from "../services/code-eval-composite.service.js";
import { shouldAutoApprove } from "../services/workbench-pipeline-helpers.service.js";
import {
  getAutoApproveThreshold,
  getCodeEvalWeight,
  getAdaptiveWeightRange,
  isAdaptiveWeightEnabled,
} from "../services/generation-settings.service.js";
import { runWithUsageContext } from "../services/usage-tracking.service.js";

const logger = createLogger("backfill-34");

const MODEL_ID = process.argv[2];
const LIMIT = process.argv[3] ? Number(process.argv[3]) : undefined;
if (!MODEL_ID) throw new Error("usage: backfill-issue-34.ts <model_id> [limit]");

const SCREENSHOT_FIELDS: Array<{ angle: string; field: string }> = [
  { angle: "front", field: "screenshotFront" },
  { angle: "back", field: "screenshotBack" },
  { angle: "left", field: "screenshotLeft" },
  { angle: "right", field: "screenshotRight" },
  { angle: "top", field: "screenshotTop" },
  { angle: "bottom", field: "screenshotBottom" },
  { angle: "ortho_45", field: "screenshotOrtho45" },
  { angle: "ortho_45_bottom", field: "screenshotOrtho45Bottom" },
];

async function loadScreenshots(ex: Record<string, unknown>): Promise<LabeledImage[]> {
  const images: LabeledImage[] = [];
  for (const { angle, field } of SCREENSHOT_FIELDS) {
    const path = ex[field] as string | null;
    if (!path) continue;
    if (path.startsWith("data:") || path.length > 500) {
      images.push({ angle, base64: path.replace(/^data:image\/\w+;base64,/, "") });
    } else if (await storageFileExists(path)) {
      images.push({ angle, base64: (await readStorageFile({ relativePath: path })).toString("base64") });
    }
  }
  return images;
}

async function main() {
  const modelConfig = await resolveModelConfigById(MODEL_ID);
  const threshold = await getAutoApproveThreshold("workbench");
  const codeEvalWeight = await getCodeEvalWeight("workbench");
  const adaptiveRange = (await isAdaptiveWeightEnabled()) ? await getAdaptiveWeightRange() : 0;

  const pending = await prisma.workbenchExample.findMany({
    where: {
      evalChecklistState: "placeholder",
      experimentRunId: null,
      renderStatus: "success",
      screenshotFront: { not: null },
    },
    orderBy: { id: "asc" },
    take: LIMIT,
    select: {
      id: true, visualScore: true, evalScore: true, codeEvalScore: true,
      assertionPassRate: true, approvalStatus: true,
      screenshotFront: true, screenshotBack: true, screenshotLeft: true, screenshotRight: true,
      screenshotTop: true, screenshotBottom: true, screenshotOrtho45: true, screenshotOrtho45Bottom: true,
      promptRef: {
        select: {
          prompt: true, constructionSpec: true, verificationChecklist: true,
          verificationCriteria: true, evalPlan: true,
          category: { select: { name: true, complexity: true } },
        },
      },
    },
  });

  logger.info({ total: pending.length, model: modelConfig.label, threshold, codeEvalWeight },
    "issue #34 backfill starting (visual eval only; code score held constant)");

  let done = 0, failed = 0, lost = 0, gained = 0;

  for (const ex of pending) {
    try {
      const images = await loadScreenshots(ex as unknown as Record<string, unknown>);
      if (images.length === 0) { failed++; logger.warn({ id: ex.id }, "no screenshots — skipped"); continue; }

      const criteria = toAnnotatedCriteria(ex.promptRef.verificationCriteria);
      const checklist = deriveVisualChecklist(
        ex.promptRef.verificationCriteria,
        (ex.promptRef.verificationChecklist as string[] | null) ?? undefined,
      );

      const vlm = await runWithUsageContext(
        { workbenchExampleId: ex.id, source: "workbench", sourceLabel: "issue-34 backfill" },
        () => evaluateModelWithConfig({
          userPrompt: ex.promptRef.prompt,
          categoryName: ex.promptRef.category.name,
          complexity: ex.promptRef.category.complexity,
          images,
          verificationChecklist: checklist,
          constructionSpec: ex.promptRef.constructionSpec ?? undefined,
        }, modelConfig),
      );

      const codeScore = ex.codeEvalScore === null ? null : Number(ex.codeEvalScore);
      const apr = ex.assertionPassRate === null ? null : Number(ex.assertionPassRate);
      const resolved = resolveCodeEvalWeight({
        globalDefault: codeEvalWeight,
        evalPlan: parseEvalPlan(ex.promptRef.evalPlan ?? null),
        annotatedCriteria: criteria,
        adaptiveWeightRange: adaptiveRange,
      });
      const composite = computeCompositeScore(
        vlm.score, codeScore, apr, resolved.weight, criteria, adaptiveRange, resolved.source,
      );
      const approved = shouldAutoApprove(composite.compositeScore, threshold, vlm.checklistResults ?? null, true);

      const wasApproved = ex.approvalStatus === "auto_approved";
      if (wasApproved && !approved) lost++;
      if (!wasApproved && approved) gained++;

      await prisma.workbenchExample.update({
        where: { id: ex.id },
        data: {
          visualScore: vlm.score,
          evalScore: composite.compositeScore,
          compositeWeightSource: resolved.source,
          evalIssues: vlm.issues.length ? vlm.issues : undefined,
          evalSuggestions: vlm.suggestions.length ? vlm.suggestions : undefined,
          evalChecklistResults: vlm.checklistResults
            ? (vlm.checklistResults as unknown as Prisma.InputJsonValue)
            : undefined,
          vlmModel: vlm.vlmModel,
          vlmRawResponse: vlm.rawResponse ?? null,
          vlmReasoning: vlm.reasoning ?? null,
          vlmSystemPrompt: vlm.systemPrompt ?? null,
          evalChecklistState: classifyChecklist(checklist),
          approvalStatus: approved ? "auto_approved" : "pending",
        },
      });

      done++;
      if (done % 25 === 0) {
        logger.info({ done, total: pending.length, failed, lost, gained }, "backfill progress");
      }
    } catch (err) {
      failed++;
      logger.error({ err, id: ex.id }, "backfill failed for example — left as placeholder for retry");
    }
  }

  logger.info({ done, failed, lost, gained }, "issue #34 backfill finished");
  await prisma.$disconnect();
}

main().catch((e) => { logger.error({ err: e }, "backfill aborted"); process.exit(1); });
