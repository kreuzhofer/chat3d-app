/**
 * The judge training export's pool (issue #94): every completed sitting under
 * the current Instrument id, its candidate and reference re-paired the way
 * the screen pairs them, labelled by `judge-sft-labels`, the held-out rows
 * removed, the agreed passes capped. Database in, labelled items out.
 */
import { prisma } from "../../db/prisma.js";
import { createLogger } from "../../utils/logger.js";
import { drawIds } from "../adjudication-draw.service.js";
import { pairItems } from "../qualification-screen.service.js";
import { loadProductionRun, loadRun, RunNotPairableError } from "../qualification-screen-load.service.js";
import { currentInstrumentId } from "../visual-eval-instrument-id.service.js";
import { heldOutRows, HELD_OUT_EXPERIMENT_IDS, type HeldOutRows } from "./judge-sft-held-out.js";
import {
  capAgreedPasses, decisionKey, dropUnpaired, labelPairs, mergeLabels,
  type CapReport, type DecisionRecord, type LabelDrops, type LabelledItem,
} from "./judge-sft-labels.js";

const logger = createLogger("judge-sft-pool");

/** The agreed-pass cap the map decided (the corpus runs 6,269 : 418). */
export const PASSES_PER_FAIL = 3;
/** The seed of the agreed-pass draw, so two exports of the same database agree. */
export const CAP_DRAW_SEED = 94;

export interface PoolSitting {
  id: string;
  title: string;
  instrumentId: string;
  candidateLabel: string;
  referenceLabel: string;
  referenceRunId: string;
  /** Items this sitting contributed after the held-out cut, before the cap. */
  labelled: number;
  heldOut: number;
  drops: LabelDrops;
}

export interface SkippedSitting { id: string; title: string; reason: string }

/** The reference's whole-example answer, for the sample's score and issues. */
export interface ReferenceSummary { score: number | null; issues: string[]; suggestions: string[] }

export interface JudgePool {
  instrumentId: string;
  heldOut: { experimentIds: string[] } & HeldOutRows;
  sittings: PoolSitting[];
  skipped: SkippedSitting[];
  cap: CapReport;
  items: LabelledItem[];
  /** Keyed by example id; the reference of the sitting that contributed the example. */
  reference: Map<string, ReferenceSummary>;
}

export async function loadJudgePool(): Promise<JudgePool> {
  const instrumentId = await currentInstrumentId();
  const held = await heldOutRows();
  const heldOut = new Set([...held.exampleIds, ...held.siblingExampleIds]);
  const sittings = await prisma.adjudicationSitting.findMany({
    where: { completedAt: { not: null } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, title: true, instrumentId: true, candidateSource: true, candidateRunId: true,
      referenceRunId: true, sampleExperimentId: true, candidateLabel: true, referenceLabel: true,
    },
  });

  const pool: PoolSitting[] = [];
  const skipped: SkippedSitting[] = [];
  const all: LabelledItem[] = [];
  const reference = new Map<string, ReferenceSummary>();

  for (const s of sittings) {
    if (s.instrumentId !== instrumentId) {
      skipped.push({ id: s.id, title: s.title, reason: `instrument ${s.instrumentId} is not the current ${instrumentId}` });
      continue;
    }
    const candidateId = s.candidateSource === "run" ? s.candidateRunId : s.sampleExperimentId;
    const referenceRunId = s.referenceRunId;
    if (!candidateId || !referenceRunId) {
      skipped.push({ id: s.id, title: s.title, reason: "the sitting's runs are no longer on record" });
      continue;
    }
    try {
      const cand = s.candidateSource === "run" ? await loadRun(candidateId) : await loadProductionRun(candidateId);
      const ref = await loadRun(referenceRunId);
      const pairs = pairItems(cand, ref);
      const decisions = new Map<string, DecisionRecord>();
      for (const a of await prisma.adjudication.findMany({
        where: { sittingId: s.id, decision: { not: null } },
        select: { exampleId: true, itemIndex: true, question: true, decision: true, decisionSource: true },
      })) {
        decisions.set(decisionKey(a.exampleId, a.itemIndex), {
          exampleId: a.exampleId, itemIndex: a.itemIndex, question: a.question, decision: a.decision as DecisionRecord["decision"], source: a.decisionSource,
        });
      }
      const paired = dropUnpaired(pairs);
      const { items, drops } = labelPairs(paired.pairs, decisions, s.id);
      drops.unpaired = paired.unpaired;
      if (paired.unpaired > 0) logger.warn({ sittingId: s.id, unpaired: paired.unpaired, of: pairs.length }, "positions where the judges answered different questions were not paired");
      const kept = items.filter((i) => !heldOut.has(i.exampleId));
      all.push(...kept);
      for (const r of await prisma.vlmExperimentResult.findMany({
        where: { runId: referenceRunId },
        select: { exampleId: true, visualScore: true, issues: true, suggestions: true },
      })) {
        if (!reference.has(r.exampleId)) {
          reference.set(r.exampleId, {
            score: r.visualScore == null ? null : Number(r.visualScore),
            issues: Array.isArray(r.issues) ? (r.issues as unknown[]).map(String) : [],
            suggestions: Array.isArray(r.suggestions) ? (r.suggestions as unknown[]).map(String) : [],
          });
        }
      }
      pool.push({
        id: s.id, title: s.title, instrumentId: s.instrumentId, candidateLabel: s.candidateLabel,
        referenceLabel: s.referenceLabel, referenceRunId,
        labelled: kept.length, heldOut: items.length - kept.length, drops,
      });
    } catch (e) {
      if (!(e instanceof RunNotPairableError)) throw e;
      skipped.push({ id: s.id, title: s.title, reason: e.message });
      logger.warn({ sittingId: s.id, err: e }, "sitting skipped by the judge export");
    }
  }

  const merged = mergeLabels(all);
  const { items, cap } = capAgreedPasses(merged, PASSES_PER_FAIL, (keys, n) => drawIds(keys, n, CAP_DRAW_SEED));
  return {
    instrumentId,
    heldOut: { experimentIds: [...HELD_OUT_EXPERIMENT_IDS], ...held },
    sittings: pool, skipped, cap, items, reference,
  };
}
