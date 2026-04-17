/**
 * Data Quality Report Service
 *
 * Provides overall and per-category data quality statistics for the workbench,
 * focusing on completeness of spec, eval, and screenshot data.
 */

import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("data-quality");

export interface DataQualityStats {
  totalPrompts: number;
  promptsWithExamples: number;
  // Best example eval source breakdown
  evalSourceComposite: number;
  evalSourceCodeOnly: number;
  evalSourceLegacy: number;
  // Best example field completeness
  missingScreenshots: number;
  missingVisualScore: number;
  missingCodeEvalScore: number;
  // Prompt-level spec field completeness
  missingSpec: number;
  missingConstructionSpec: number;
  missingAssertions: number;
  missingChecklist: number;
  missingCriteria: number;
  // Assertion execution rate on best examples
  assertionsRan: number;
  // Training data coverage (count WITH data per purpose)
  trainingVlmEval: number;
  trainingCodeReview: number;
  trainingAgentCodegen: number;
  trainingSpecGen: number;
  trainingSpecEnrich: number;
}

export interface CategoryDataQuality {
  categoryId: string;
  categoryName: string;
  stats: DataQualityStats;
}

export interface DataQualityReport {
  overall: DataQualityStats;
  categories: CategoryDataQuality[];
}

interface RawRow {
  category_id: string;
  category_name: string;
  total_prompts: bigint;
  prompts_with_examples: bigint;
  eval_source_composite: bigint;
  eval_source_code_only: bigint;
  eval_source_legacy: bigint;
  missing_screenshots: bigint;
  missing_visual_score: bigint;
  missing_code_eval_score: bigint;
  missing_spec: bigint;
  missing_construction_spec: bigint;
  missing_assertions: bigint;
  missing_checklist: bigint;
  missing_criteria: bigint;
  assertions_ran: bigint;
  training_vlm_eval: bigint;
  training_code_review: bigint;
  training_agent_codegen: bigint;
  training_spec_gen: bigint;
  training_spec_enrich: bigint;
}

function toStats(row: RawRow): DataQualityStats {
  return {
    totalPrompts: Number(row.total_prompts),
    promptsWithExamples: Number(row.prompts_with_examples),
    evalSourceComposite: Number(row.eval_source_composite),
    evalSourceCodeOnly: Number(row.eval_source_code_only),
    evalSourceLegacy: Number(row.eval_source_legacy),
    missingScreenshots: Number(row.missing_screenshots),
    missingVisualScore: Number(row.missing_visual_score),
    missingCodeEvalScore: Number(row.missing_code_eval_score),
    missingSpec: Number(row.missing_spec),
    missingConstructionSpec: Number(row.missing_construction_spec),
    missingAssertions: Number(row.missing_assertions),
    missingChecklist: Number(row.missing_checklist),
    missingCriteria: Number(row.missing_criteria),
    assertionsRan: Number(row.assertions_ran),
    trainingVlmEval: Number(row.training_vlm_eval),
    trainingCodeReview: Number(row.training_code_review),
    trainingAgentCodegen: Number(row.training_agent_codegen),
    trainingSpecGen: Number(row.training_spec_gen),
    trainingSpecEnrich: Number(row.training_spec_enrich),
  };
}

function sumStats(rows: RawRow[]): DataQualityStats {
  const zero: DataQualityStats = {
    totalPrompts: 0, promptsWithExamples: 0,
    evalSourceComposite: 0, evalSourceCodeOnly: 0, evalSourceLegacy: 0,
    missingScreenshots: 0, missingVisualScore: 0, missingCodeEvalScore: 0,
    missingSpec: 0, missingConstructionSpec: 0,
    missingAssertions: 0, missingChecklist: 0, missingCriteria: 0,
    assertionsRan: 0,
    trainingVlmEval: 0, trainingCodeReview: 0, trainingAgentCodegen: 0,
    trainingSpecGen: 0, trainingSpecEnrich: 0,
  };
  for (const row of rows) {
    const s = toStats(row);
    for (const key of Object.keys(zero) as (keyof DataQualityStats)[]) {
      (zero as Record<string, number>)[key] += s[key];
    }
  }
  return zero;
}

export async function getDataQualityReport(): Promise<DataQualityReport> {
  logger.info("generating data quality report");

  const rows = await prisma.$queryRaw<RawRow[]>`
    WITH best_examples AS (
      SELECT DISTINCT ON (e.prompt_id)
        e.prompt_id,
        e.eval_source,
        e.screenshot_front IS NOT NULL AS has_screenshot,
        e.visual_score IS NOT NULL AS has_visual_score,
        e.code_eval_score IS NOT NULL AS has_code_eval_score,
        e.assertion_pass_rate IS NOT NULL AS has_assertions_ran,
        e.vlm_raw_response IS NOT NULL AND e.vlm_system_prompt IS NOT NULL AS has_training_vlm,
        e.code_review_raw_response IS NOT NULL AND e.code_review_system_prompt IS NOT NULL AS has_training_code_review,
        e.agent_conversation IS NOT NULL AND e.agent_system_prompt IS NOT NULL AS has_training_agent
      FROM workbench_examples e
      WHERE e.render_status = 'success' AND e.experiment_run_id IS NULL
      ORDER BY e.prompt_id,
        CASE e.approval_status
          WHEN 'human_approved' THEN 1
          WHEN 'auto_approved' THEN 2
          WHEN 'pending' THEN 3
          WHEN 'rejected' THEN 4
        END,
        e.eval_score DESC NULLS LAST
    )
    SELECT
      c.id AS category_id,
      c.name AS category_name,
      COUNT(p.id) AS total_prompts,
      COUNT(be.prompt_id) AS prompts_with_examples,
      COUNT(be.prompt_id) FILTER (WHERE be.eval_source IN ('composite', 'visual_only')) AS eval_source_composite,
      COUNT(be.prompt_id) FILTER (WHERE be.eval_source = 'code_only') AS eval_source_code_only,
      COUNT(be.prompt_id) FILTER (WHERE be.eval_source IS NULL AND be.prompt_id IS NOT NULL) AS eval_source_legacy,
      COUNT(be.prompt_id) FILTER (WHERE NOT be.has_screenshot) AS missing_screenshots,
      COUNT(be.prompt_id) FILTER (WHERE NOT be.has_visual_score) AS missing_visual_score,
      COUNT(be.prompt_id) FILTER (WHERE NOT be.has_code_eval_score) AS missing_code_eval_score,
      COUNT(p.id) FILTER (WHERE p.spec_interpretation IS NULL) AS missing_spec,
      COUNT(p.id) FILTER (WHERE p.construction_spec IS NULL) AS missing_construction_spec,
      COUNT(p.id) FILTER (WHERE p.code_assertions IS NULL) AS missing_assertions,
      COUNT(p.id) FILTER (WHERE p.verification_checklist IS NULL) AS missing_checklist,
      COUNT(p.id) FILTER (WHERE p.verification_criteria IS NULL) AS missing_criteria,
      COUNT(be.prompt_id) FILTER (WHERE be.has_assertions_ran) AS assertions_ran,
      COUNT(be.prompt_id) FILTER (WHERE be.has_training_vlm) AS training_vlm_eval,
      COUNT(be.prompt_id) FILTER (WHERE be.has_training_code_review) AS training_code_review,
      COUNT(be.prompt_id) FILTER (WHERE be.has_training_agent) AS training_agent_codegen,
      COUNT(p.id) FILTER (WHERE p.spec_raw_response IS NOT NULL AND p.spec_system_prompt IS NOT NULL) AS training_spec_gen,
      COUNT(p.id) FILTER (WHERE p.enrichment_raw_response IS NOT NULL AND p.enrichment_system_prompt IS NOT NULL) AS training_spec_enrich
    FROM workbench_categories c
    JOIN workbench_example_prompts p ON p.category_id = c.id
    LEFT JOIN best_examples be ON be.prompt_id = p.id
    GROUP BY c.id, c.name
    ORDER BY c.rank
  `;

  const categories: CategoryDataQuality[] = rows.map((row) => ({
    categoryId: row.category_id,
    categoryName: row.category_name,
    stats: toStats(row),
  }));

  const overall = sumStats(rows);

  logger.info({ categoryCount: categories.length, totalPrompts: overall.totalPrompts }, "data quality report generated");

  return { overall, categories };
}
