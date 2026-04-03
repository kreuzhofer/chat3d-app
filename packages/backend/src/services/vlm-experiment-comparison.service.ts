/**
 * VLM Experiment Comparison Service
 *
 * Computes aggregate metrics, ground-truth correlation, and inter-rater
 * agreement across VLM experiment runs.
 */

import { prisma } from "../db/prisma.js";
import { ExperimentError } from "./experiment.service.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("vlm-experiment-compare");

// ── Types ───────────────────────────────────────────────────────────

export interface VlmRunMetrics {
  runId: string;
  modelLabel: string;
  runOrder: number;
  totalExamples: number;
  evaluatedCount: number;
  errorCount: number;
  // Score distribution
  avgScore: number | null;
  medianScore: number | null;
  stddevScore: number | null;
  minScore: number | null;
  maxScore: number | null;
  // Ground truth correlation
  correlationExistingVisualScore: number | null;
  correlationAssertionPassRate: number | null;
  correlationCodeEvalScore: number | null;
  // Score separation (assertion pass vs fail)
  avgScoreAssertionPass: number | null;
  avgScoreAssertionFail: number | null;
  scoreSeparation: number | null;
  // Cost
  totalPromptTokens: number;
  totalCompletionTokens: number;
  avgDurationMs: number | null;
}

export interface VlmExampleComparison {
  exampleId: string;
  promptText: string;
  categoryName: string;
  approvalStatus: string;
  existingVisualScore: number | null;
  existingCodeEvalScore: number | null;
  existingEvalScore: number | null;
  assertionPassRate: number | null;
  screenshotIso: string | null;
  runs: Array<{
    runId: string;
    modelLabel: string;
    visualScore: number | null;
    issues: string[];
    error: string | null;
    durationMs: number | null;
  }>;
}

export interface InterRaterPair {
  runA: { id: string; label: string };
  runB: { id: string; label: string };
  spearmanCorrelation: number | null;
  meanAbsDifference: number | null;
  agreementCount: number;
  totalPaired: number;
}

// ── Spearman rank correlation ───────────────────────────────────────

function computeRanks(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j < indexed.length && indexed[j].v === indexed[i].v) j++;
    const avgRank = (i + j - 1) / 2 + 1; // 1-based average rank for ties
    for (let k = i; k < j; k++) ranks[indexed[k].i] = avgRank;
    i = j;
  }
  return ranks;
}

function spearmanCorrelation(x: number[], y: number[]): number | null {
  if (x.length !== y.length || x.length < 3) return null;
  const n = x.length;
  const ranksX = computeRanks(x);
  const ranksY = computeRanks(y);

  const meanX = ranksX.reduce((s, v) => s + v, 0) / n;
  const meanY = ranksY.reduce((s, v) => s + v, 0) / n;

  let num = 0, denomX = 0, denomY = 0;
  for (let i = 0; i < n; i++) {
    const dx = ranksX[i] - meanX;
    const dy = ranksY[i] - meanY;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denom = Math.sqrt(denomX * denomY);
  return denom === 0 ? null : Math.round((num / denom) * 1000) / 1000;
}

// ── Aggregate comparison ────────────────────────────────────────────

export async function getVlmComparison(experimentId: string): Promise<{ runs: VlmRunMetrics[] }> {
  const exp = await prisma.experiment.findUnique({ where: { id: experimentId }, select: { id: true, type: true } });
  if (!exp || exp.type !== "vlm_comparison") throw new ExperimentError("VLM experiment not found", 404);

  const runs = await prisma.experimentRun.findMany({
    where: { experimentId },
    select: { id: true, modelLabel: true, runOrder: true },
    orderBy: { runOrder: "asc" },
  });

  // Load all results with ground truth from examples
  const results = await prisma.vlmExperimentResult.findMany({
    where: { run: { experimentId } },
    select: {
      runId: true,
      exampleId: true,
      visualScore: true,
      promptTokens: true,
      completionTokens: true,
      durationMs: true,
      error: true,
      example: {
        select: {
          visualScore: true,
          assertionPassRate: true,
          codeEvalScore: true,
        },
      },
    },
  });

  // Group by run
  const byRun = new Map<string, typeof results>();
  for (const r of results) {
    const arr = byRun.get(r.runId) ?? [];
    arr.push(r);
    byRun.set(r.runId, arr);
  }

  const metrics: VlmRunMetrics[] = runs.map((run) => {
    const runResults = byRun.get(run.id) ?? [];
    const scores = runResults
      .filter((r) => r.visualScore != null && r.error == null)
      .map((r) => Number(r.visualScore));
    const errorCount = runResults.filter((r) => r.error != null).length;

    // Score distribution
    const sorted = [...scores].sort((a, b) => a - b);
    const avg = scores.length > 0 ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10 : null;
    const median = sorted.length > 0
      ? sorted.length % 2 === 0
        ? Math.round(((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) * 10) / 10
        : sorted[Math.floor(sorted.length / 2)]
      : null;
    const stddev = scores.length > 1
      ? Math.round(Math.sqrt(scores.reduce((s, v) => s + (v - avg!) ** 2, 0) / (scores.length - 1)) * 10) / 10
      : null;

    // Ground truth correlation
    const paired = runResults
      .filter((r) => r.visualScore != null && r.error == null);

    const vlmScores = paired.map((r) => Number(r.visualScore));
    const existingVisualScores = paired.map((r) => r.example.visualScore != null ? Number(r.example.visualScore) : null);
    const assertionRates = paired.map((r) => r.example.assertionPassRate != null ? Number(r.example.assertionPassRate) : null);
    const codeEvalScores = paired.map((r) => r.example.codeEvalScore != null ? Number(r.example.codeEvalScore) : null);

    // Filter to pairs where both values exist
    const visualPairs = vlmScores.filter((_, i) => existingVisualScores[i] != null);
    const visualGt = existingVisualScores.filter((v) => v != null) as number[];
    const assertionPairs = vlmScores.filter((_, i) => assertionRates[i] != null);
    const assertionGt = assertionRates.filter((v) => v != null) as number[];
    const codePairs = vlmScores.filter((_, i) => codeEvalScores[i] != null);
    const codeGt = codeEvalScores.filter((v) => v != null) as number[];

    // Score separation (assertion pass rate = 1.0 vs < 1.0)
    const passScores = paired
      .filter((r) => r.example.assertionPassRate != null && Number(r.example.assertionPassRate) >= 1.0)
      .map((r) => Number(r.visualScore));
    const failScores = paired
      .filter((r) => r.example.assertionPassRate != null && Number(r.example.assertionPassRate) < 1.0)
      .map((r) => Number(r.visualScore));
    const avgPass = passScores.length > 0 ? Math.round((passScores.reduce((s, v) => s + v, 0) / passScores.length) * 10) / 10 : null;
    const avgFail = failScores.length > 0 ? Math.round((failScores.reduce((s, v) => s + v, 0) / failScores.length) * 10) / 10 : null;

    return {
      runId: run.id,
      modelLabel: run.modelLabel,
      runOrder: run.runOrder,
      totalExamples: runResults.length,
      evaluatedCount: scores.length,
      errorCount,
      avgScore: avg,
      medianScore: median,
      stddevScore: stddev,
      minScore: sorted.length > 0 ? sorted[0] : null,
      maxScore: sorted.length > 0 ? sorted[sorted.length - 1] : null,
      correlationExistingVisualScore: spearmanCorrelation(visualPairs, visualGt),
      correlationAssertionPassRate: spearmanCorrelation(assertionPairs, assertionGt),
      correlationCodeEvalScore: spearmanCorrelation(codePairs, codeGt),
      avgScoreAssertionPass: avgPass,
      avgScoreAssertionFail: avgFail,
      scoreSeparation: avgPass != null && avgFail != null ? Math.round((avgPass - avgFail) * 10) / 10 : null,
      totalPromptTokens: runResults.reduce((s, r) => s + (r.promptTokens ?? 0), 0),
      totalCompletionTokens: runResults.reduce((s, r) => s + (r.completionTokens ?? 0), 0),
      avgDurationMs: scores.length > 0
        ? Math.round(runResults.filter((r) => r.durationMs != null).reduce((s, r) => s + r.durationMs!, 0) / scores.length)
        : null,
    };
  });

  return { runs: metrics };
}

// ── Per-example comparison ──────────────────────────────────────────

export async function getVlmPerExampleComparison(experimentId: string): Promise<VlmExampleComparison[]> {
  const exp = await prisma.experiment.findUnique({ where: { id: experimentId }, select: { id: true, type: true } });
  if (!exp || exp.type !== "vlm_comparison") throw new ExperimentError("VLM experiment not found", 404);

  const runs = await prisma.experimentRun.findMany({
    where: { experimentId },
    select: { id: true, modelLabel: true },
    orderBy: { runOrder: "asc" },
  });

  const selections = await prisma.vlmExperimentExampleSelection.findMany({
    where: { experimentId },
    select: {
      exampleId: true,
      selectionOrder: true,
      example: {
        select: {
          approvalStatus: true,
          visualScore: true,
          codeEvalScore: true,
          evalScore: true,
          assertionPassRate: true,
          screenshotIso: true,
          promptRef: {
            select: { prompt: true, category: { select: { name: true } } },
          },
        },
      },
    },
    orderBy: { selectionOrder: "asc" },
  });

  const results = await prisma.vlmExperimentResult.findMany({
    where: { run: { experimentId } },
    select: {
      runId: true,
      exampleId: true,
      visualScore: true,
      issues: true,
      error: true,
      durationMs: true,
    },
  });

  // Index results by exampleId+runId
  const resultMap = new Map<string, typeof results[0]>();
  for (const r of results) {
    resultMap.set(`${r.exampleId}:${r.runId}`, r);
  }

  return selections.map((sel) => ({
    exampleId: sel.exampleId,
    promptText: sel.example.promptRef.prompt,
    categoryName: sel.example.promptRef.category.name,
    approvalStatus: sel.example.approvalStatus,
    existingVisualScore: sel.example.visualScore != null ? Number(sel.example.visualScore) : null,
    existingCodeEvalScore: sel.example.codeEvalScore != null ? Number(sel.example.codeEvalScore) : null,
    existingEvalScore: sel.example.evalScore != null ? Number(sel.example.evalScore) : null,
    assertionPassRate: sel.example.assertionPassRate != null ? Number(sel.example.assertionPassRate) : null,
    screenshotIso: sel.example.screenshotIso,
    runs: runs.map((run) => {
      const r = resultMap.get(`${sel.exampleId}:${run.id}`);
      return {
        runId: run.id,
        modelLabel: run.modelLabel,
        visualScore: r?.visualScore != null ? Number(r.visualScore) : null,
        issues: (r?.issues as string[] | null) ?? [],
        error: r?.error ?? null,
        durationMs: r?.durationMs ?? null,
      };
    }),
  }));
}

// ── Inter-rater agreement ───────────────────────────────────────────

export async function getVlmInterRaterAgreement(experimentId: string): Promise<{ pairs: InterRaterPair[] }> {
  const exp = await prisma.experiment.findUnique({ where: { id: experimentId }, select: { id: true, type: true } });
  if (!exp || exp.type !== "vlm_comparison") throw new ExperimentError("VLM experiment not found", 404);

  const runs = await prisma.experimentRun.findMany({
    where: { experimentId },
    select: { id: true, modelLabel: true },
    orderBy: { runOrder: "asc" },
  });

  const results = await prisma.vlmExperimentResult.findMany({
    where: { run: { experimentId }, error: null, visualScore: { not: null } },
    select: { runId: true, exampleId: true, visualScore: true },
  });

  // Group scores by run
  const scoresByRun = new Map<string, Map<string, number>>();
  for (const r of results) {
    let runMap = scoresByRun.get(r.runId);
    if (!runMap) { runMap = new Map(); scoresByRun.set(r.runId, runMap); }
    runMap.set(r.exampleId, Number(r.visualScore));
  }

  const pairs: InterRaterPair[] = [];
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const mapA = scoresByRun.get(runs[i].id) ?? new Map();
      const mapB = scoresByRun.get(runs[j].id) ?? new Map();

      // Find shared examples
      const scoresA: number[] = [];
      const scoresB: number[] = [];
      let agreementCount = 0;

      for (const [exId, scoreA] of mapA) {
        const scoreB = mapB.get(exId);
        if (scoreB == null) continue;
        scoresA.push(scoreA);
        scoresB.push(scoreB);
        if (Math.abs(scoreA - scoreB) <= 1) agreementCount++;
      }

      const totalPaired = scoresA.length;
      const meanAbsDiff = totalPaired > 0
        ? Math.round((scoresA.reduce((s, v, k) => s + Math.abs(v - scoresB[k]), 0) / totalPaired) * 10) / 10
        : null;

      pairs.push({
        runA: { id: runs[i].id, label: runs[i].modelLabel },
        runB: { id: runs[j].id, label: runs[j].modelLabel },
        spearmanCorrelation: spearmanCorrelation(scoresA, scoresB),
        meanAbsDifference: meanAbsDiff,
        agreementCount,
        totalPaired,
      });
    }
  }

  return { pairs };
}
