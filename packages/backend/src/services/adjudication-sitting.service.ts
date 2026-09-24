/**
 * The adjudication sitting (issue #92, ADR 0004).
 *
 * A sitting freezes the disagreement set of one candidate against one
 * reference under one Instrument id — the same rows, pairing and refusals
 * the qualification screen uses — and holds the human's decision on each
 * item as a row. The bar's adjudicated terms are tallied from those rows,
 * and the judge training export reads them (listAdjudicatedItems).
 */
import { prisma } from "../db/prisma.js";
import { carryIntoSitting } from "./adjudication-carry.js";
import { createLogger } from "../utils/logger.js";
import { disagreements } from "./qualification-screen-dump.js";
import { loadProductionRun, loadRun, RunNotPairableError, type LoadedRun } from "./qualification-screen-load.service.js";
import { isDecision, tallyAdjudications, type AdjudicationTally } from "./adjudication-tally.js";

const logger = createLogger("adjudication");

export type CandidateSpec = { runId: string } | { productionExperimentId: string };

export interface CreateSittingInput {
  candidate: CandidateSpec;
  referenceRunId: string;
  title?: string;
  notes?: string;
}

export class SittingError extends Error {
  constructor(message: string, readonly statusCode: number) { super(message); }
}

const STATE_WORD = { P: "pass", F: "fail", U: "uncertain" } as const;

function singleInstrument(run: LoadedRun, role: string): string {
  if (run.instrumentIds.length !== 1) {
    throw new RunNotPairableError(`${role} ${run.label} carries ${run.instrumentIds.length} instrument ids (${run.instrumentIds.join(", ")}); a sitting needs one`);
  }
  return run.instrumentIds[0];
}

/** Draw the disagreement set and freeze it as a sitting. */
export async function createSitting(input: CreateSittingInput, adjudicatorId: string | null) {
  const cand = "runId" in input.candidate ? await loadRun(input.candidate.runId) : await loadProductionRun(input.candidate.productionExperimentId);
  const ref = await loadRun(input.referenceRunId);
  const candId = singleInstrument(cand, "candidate");
  const refId = singleInstrument(ref, "reference");
  if (candId !== refId) throw new RunNotPairableError(`candidate is under ${candId}, reference under ${refId}; a sitting compares under one Instrument id`);

  const rows = disagreements(cand, ref);
  if (rows.length === 0) throw new SittingError("The candidate and the reference disagree on no item; nothing to adjudicate", 409);
  const exampleCount = new Set(rows.map((r) => r.exampleId)).size;
  const sitting = await prisma.adjudicationSitting.create({
    data: {
      title: input.title?.trim() || `${cand.label} vs ${ref.label}`,
      instrumentId: candId,
      candidateSource: "runId" in input.candidate ? "run" : "production",
      candidateRunId: "runId" in input.candidate ? input.candidate.runId : null,
      candidateLabel: cand.label,
      referenceRunId: input.referenceRunId,
      referenceLabel: ref.label,
      sampleExperimentId: cand.experimentId,
      adjudicatorId,
      notes: input.notes?.trim() || null,
      itemCount: rows.length,
      exampleCount,
      items: {
        create: rows.map((r) => ({
          exampleId: r.exampleId,
          itemIndex: r.index,
          question: r.question,
          refState: STATE_WORD[r.ref.state],
          refDetail: r.ref.detail,
          candState: STATE_WORD[r.cand.state],
          candDetail: r.cand.detail,
          arm2State: r.arm2 ? STATE_WORD[r.arm2.state] : null,
          arm2Detail: r.arm2?.detail ?? null,
        })),
      },
    },
    select: { id: true },
  });
  logger.info({ sittingId: sitting.id, items: rows.length, examples: exampleCount, instrumentId: candId }, "sitting created");
  // #102: items a person already decided against this reference run open decided, marked carried.
  await carryIntoSitting(sitting.id, input.referenceRunId);
  return getSitting(sitting.id);
}

export async function listSittings() {
  const sittings = await prisma.adjudicationSitting.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      adjudicator: { select: { id: true, displayName: true, email: true } },
      items: { select: { refState: true, candState: true, decision: true, decisionSource: true } },
    },
  });
  return sittings.map(({ items, ...s }) => ({ ...s, tally: tallyAdjudications(items) }));
}

export interface SittingItemView {
  id: string;
  exampleId: string;
  itemIndex: number;
  question: string;
  prompt: string;
  category: string;
  refState: string;
  refDetail: string;
  candState: string;
  candDetail: string;
  arm2State: string | null;
  arm2Detail: string | null;
  decision: string | null;
  /** "human" or "auto-triage" (#111). */
  decisionSource: string | null;
  note: string;
  agreedWithTriage: boolean;
  decidedAt: Date | null;
  triage: { verdict: string; confidence: string | null; what: string | null; view: string | null; resolvedBy: string | null; model: string | null; at: Date | null } | null;
}

export async function getSitting(id: string) {
  const s = await prisma.adjudicationSitting.findUnique({
    where: { id },
    include: {
      adjudicator: { select: { id: true, displayName: true, email: true } },
      items: {
        orderBy: [{ createdAt: "asc" }, { exampleId: "asc" }, { itemIndex: "asc" }],
        include: { example: { select: { promptRef: { select: { prompt: true, category: { select: { name: true } } } } } } },
      },
    },
  });
  if (!s) throw new SittingError(`Sitting ${id} not found`, 404);
  const { items, ...sitting } = s;
  const views: SittingItemView[] = items.map((it) => ({
    id: it.id, exampleId: it.exampleId, itemIndex: it.itemIndex, question: it.question,
    prompt: it.example.promptRef.prompt, category: it.example.promptRef.category.name,
    refState: it.refState, refDetail: it.refDetail, candState: it.candState, candDetail: it.candDetail,
    arm2State: it.arm2State, arm2Detail: it.arm2Detail,
    decision: it.decision, decisionSource: it.decisionSource, note: it.note, agreedWithTriage: it.agreedWithTriage, decidedAt: it.decidedAt,
    triage: it.triageVerdict
      ? { verdict: it.triageVerdict, confidence: it.triageConfidence, what: it.triageWhat, view: it.triageView, resolvedBy: it.triageResolvedBy, model: it.triageModel, at: it.triageAt }
      : null,
  }));
  return { ...sitting, items: views, tally: tallyAdjudications(items) satisfies AdjudicationTally };
}

export interface RecordAdjudicationInput {
  decision: string | null;
  note?: string;
  agreedWithTriage?: boolean;
}

/** Record (or clear) the human's decision on one item. */
export async function recordAdjudication(sittingId: string, itemId: string, input: RecordAdjudicationInput, userId: string | null) {
  if (input.decision !== null && !isDecision(input.decision)) throw new SittingError("decision must be R, C, N or null", 400);
  const item = await prisma.adjudication.findFirst({ where: { id: itemId, sittingId }, select: { id: true, triageVerdict: true, sitting: { select: { completedAt: true } } } });
  if (!item) throw new SittingError(`Item ${itemId} is not in sitting ${sittingId}`, 404);
  if (item.sitting.completedAt) throw new SittingError("The sitting is completed; reopen it to change a decision", 409);
  const agreed = input.agreedWithTriage === true;
  if (agreed && (!item.triageVerdict || item.triageVerdict !== input.decision)) {
    throw new SittingError("agreedWithTriage needs a triage reading with the same decision", 400);
  }
  const updated = await prisma.adjudication.update({
    where: { id: itemId },
    data: {
      decision: input.decision,
      decisionSource: input.decision ? "human" : null,
      note: input.note ?? "",
      agreedWithTriage: input.decision ? agreed : false,
      decidedById: input.decision ? userId : null,
      decidedAt: input.decision ? new Date() : null,
    },
    select: { id: true, decision: true, decisionSource: true, note: true, agreedWithTriage: true, decidedAt: true },
  });
  const tallyRows = await prisma.adjudication.findMany({ where: { sittingId }, select: { refState: true, candState: true, decision: true, decisionSource: true } });
  return { item: updated, tally: tallyAdjudications(tallyRows) };
}

/** Close a sitting once every hard flip carries a decision; `reopen` clears the close. */
export async function completeSitting(id: string, reopen = false) {
  const s = await prisma.adjudicationSitting.findUnique({ where: { id }, include: { items: { select: { refState: true, candState: true, decision: true, decisionSource: true } } } });
  if (!s) throw new SittingError(`Sitting ${id} not found`, 404);
  if (reopen) {
    await prisma.adjudicationSitting.update({ where: { id }, data: { completedAt: null } });
    return getSitting(id);
  }
  const t = tallyAdjudications(s.items);
  if (!t.complete) throw new SittingError(`${t.open} of ${t.hard} hard flips are still open`, 409);
  await prisma.adjudicationSitting.update({ where: { id }, data: { completedAt: new Date() } });
  logger.info({ sittingId: id, ...t }, "sitting completed");
  return getSitting(id);
}

/**
 * Every decided item across sittings, for the judge training export (#94):
 * R and C are the correction signal, N is listed so the export can exclude
 * the item from the agreed set too.
 */
export async function listAdjudicatedItems(filter: { instrumentId?: string } = {}) {
  return prisma.adjudication.findMany({
    where: { decision: { not: null }, ...(filter.instrumentId ? { sitting: { instrumentId: filter.instrumentId } } : {}) },
    select: {
      id: true, exampleId: true, itemIndex: true, question: true, decision: true, note: true,
      refState: true, refDetail: true, candState: true, candDetail: true, decidedAt: true,
      sitting: { select: { id: true, title: true, instrumentId: true, candidateLabel: true, referenceLabel: true, sampleExperimentId: true, origin: true } },
    },
    orderBy: [{ sitting: { createdAt: "asc" } }, { exampleId: "asc" }, { itemIndex: "asc" }],
  });
}
