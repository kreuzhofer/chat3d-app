/**
 * The one-sided pre-decision (issue #111, decided on #108): when the third
 * judge sides with the incumbent (C), the item is a training label without
 * review — Fable's C-side readings were right 76 of 77 times, Kimi K3's 18 of
 * 20 at high confidence. A reading that sides with the reference, or says N,
 * is never pre-decided: it is the human's. A decision already recorded is
 * never touched.
 *
 * The rule is pure; the service applies it to a sitting's open items.
 */
import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";
import { SittingError } from "./adjudication-sitting.service.js";
import { tallyAdjudications } from "./adjudication-tally.js";

const logger = createLogger("adjudication-pre-decide");

/** `decision_source` values: a person decided, or the rule did. */
export const HUMAN_SOURCE = "human";
export const AUTO_SOURCE = "auto-triage";

export interface PreDecideInput {
  decision: string | null;
  triageVerdict: string | null;
  triageConfidence: string | null;
  triageModel: string | null;
}

/** Fable's C-side readings hold at any confidence; any other third judge only at high. */
function confidenceSuffices(model: string | null, confidence: string | null): boolean {
  if (/fable/i.test(model ?? "")) return true;
  return (confidence ?? "").toLowerCase() === "high";
}

/** The rule: a C to record with its note, or null when the item stays open. */
export function autoDecision(it: PreDecideInput): { decision: "C"; note: string } | null {
  if (it.decision !== null) return null;
  if (it.triageVerdict !== "C") return null;
  if (!confidenceSuffices(it.triageModel, it.triageConfidence)) return null;
  return { decision: "C", note: `auto: ${it.triageModel ?? "the third judge"} sided with the incumbent (${it.triageConfidence ?? "confidence unknown"}) — #108's one-sided rule` };
}

/** Apply the rule to a sitting's open items; idempotent. Returns how many it decided and the tally after. */
export async function preDecideSitting(sittingId: string) {
  const sitting = await prisma.adjudicationSitting.findUnique({
    where: { id: sittingId },
    select: { completedAt: true, referencePasses: true, items: { select: { id: true, decision: true, triageVerdict: true, triageConfidence: true, triageModel: true } } },
  });
  if (!sitting) throw new SittingError(`Sitting ${sittingId} not found`, 404);
  if (sitting.completedAt) throw new SittingError("The sitting is completed; reopen it to pre-decide", 409);
  let decided = 0;
  for (const it of sitting.items) {
    const auto = autoDecision(it);
    if (!auto) continue;
    await prisma.adjudication.update({
      where: { id: it.id },
      data: { decision: auto.decision, decisionSource: AUTO_SOURCE, note: auto.note, agreedWithTriage: true, decidedById: null, decidedAt: new Date() },
    });
    decided++;
  }
  const rows = await prisma.adjudication.findMany({ where: { sittingId }, select: { refState: true, candState: true, decision: true, decisionSource: true } });
  logger.info({ sittingId, decided, items: sitting.items.length }, "pre-decided C-side items");
  return { decided, tally: tallyAdjudications(rows, sitting.referencePasses) };
}
