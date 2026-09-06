/**
 * Export admission (ADR 0003, ADR 0004; issue #62).
 *
 * The training export trusts an approved row on one of two grounds. A human
 * decided it: admitted as it stands, whatever instrument or judge rated it,
 * because the verdict is the human's and not derived from that rating. Or
 * the judge decided it: admitted only when the rating was answered under the
 * current Instrument id (otherwise Stale, re-rated by the batch) by a judge
 * qualified under that id (otherwise Provisional, admitted without re-rating
 * the day its judge qualifies).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { QUALIFIED_JUDGES, type QualifiedJudge } from "../visual-eval-qualified-judges.js";

const APPROVED = ["auto_approved", "human_approved"];

/** The export's population: production rows with a successful render. */
const RENDERED: Prisma.WorkbenchExampleWhereInput = { renderStatus: "success", experimentRunId: null };

/** The judges qualified under `instrumentId`; grants under any other id are revoked for it. */
export function qualifiedUnder(
  instrumentId: string,
  qualified: readonly QualifiedJudge[] = QUALIFIED_JUDGES,
): QualifiedJudge[] {
  return qualified.filter((j) => j.instrumentId === instrumentId);
}

function judgeStamps(judges: QualifiedJudge[]): Prisma.WorkbenchExampleWhereInput[] {
  return judges.map((j) => ({ vlmModel: j.model, vlmThinkingEffort: j.thinkingEffort }));
}

/** Approved rows the training export admits. */
export function admittedWhere(
  currentInstrumentId: string,
  qualified: readonly QualifiedJudge[] = QUALIFIED_JUDGES,
): Prisma.WorkbenchExampleWhereInput {
  const judges = judgeStamps(qualifiedUnder(currentInstrumentId, qualified));
  const grounds: Prisma.WorkbenchExampleWhereInput[] = [{ approvalStatus: "human_approved" }];
  if (judges.length > 0) {
    grounds.push({ approvalStatus: "auto_approved", vlmInstrumentId: currentInstrumentId, OR: judges });
  }
  return { OR: grounds };
}

/** Judge-derived approvals rated under another id, or before ids existed. */
export function staleApprovedWhere(currentInstrumentId: string): Prisma.WorkbenchExampleWhereInput {
  return {
    approvalStatus: "auto_approved",
    OR: [{ vlmInstrumentId: null }, { vlmInstrumentId: { not: currentInstrumentId } }],
  };
}

export interface ExportAdmission {
  /** Judges qualified under the current instrument id; empty while none is. */
  qualifiedJudges: Array<{ model: string; thinkingEffort: string }>;
  /** Approved production rows with a successful render. */
  approved: number;
  /** ...admitted: a human's verdict, or a judge's under the current instrument by a judge qualified under it. */
  admitted: number;
  /** ...Provisional: a judge's verdict under the current instrument, by a judge not qualified under it. */
  provisional: number;
  /** ...Stale: a judge's verdict under another instrument id, or before ids existed — the re-rating batch's work. */
  stale: number;
}

/**
 * How the approved rows fall against the admission right now. The three
 * counts partition `approved` by construction: a human's verdict is always
 * admitted, and a judge's is stale, admitted, or else provisional.
 */
export async function getExportAdmission(
  currentInstrumentId: string,
  qualified: readonly QualifiedJudge[] = QUALIFIED_JUDGES,
): Promise<ExportAdmission> {
  const [approved, admitted, stale] = await Promise.all([
    prisma.workbenchExample.count({ where: { ...RENDERED, approvalStatus: { in: APPROVED } } }),
    prisma.workbenchExample.count({ where: { ...RENDERED, ...admittedWhere(currentInstrumentId, qualified) } }),
    prisma.workbenchExample.count({ where: { ...RENDERED, ...staleApprovedWhere(currentInstrumentId) } }),
  ]);
  return {
    qualifiedJudges: qualifiedUnder(currentInstrumentId, qualified).map((j) => ({ model: j.model, thinkingEffort: j.thinkingEffort })),
    approved,
    admitted,
    provisional: approved - admitted - stale,
    stale,
  };
}
