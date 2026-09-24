/**
 * Carry decided verdicts into a new sitting (issue #102).
 *
 * A re-drawn pair against the same reference run repeats items a person has
 * already decided: same example, same position, same question, both judges'
 * states unchanged. Deciding them again is wasted review and a second chance
 * to disagree with oneself. Such items open already decided, marked
 * `carried`, with the original note and decider; they count in ADR 0004's
 * terms as the human verdicts they are, and a person can still overrule.
 *
 * Only a person's decisions carry — never the rule's (#111) and never N-less
 * open items. The pure part matches; the service applies it at creation.
 */
import { prisma } from "../db/prisma.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("adjudication-carry");

export const CARRIED_SOURCE = "carried";

export interface CarryKey { exampleId: string; itemIndex: number; question: string; refState: string; candState: string }
export interface PriorDecision extends CarryKey { decision: string; note: string; decidedById: string | null; sittingTitle: string }

const key = (k: CarryKey) => `${k.exampleId}:${k.itemIndex}:${k.question.trim().toLowerCase()}:${k.refState}:${k.candState}`;

/** Pure: for each new item, the prior human decision on the identical item, if any. */
export function matchCarried<T extends CarryKey>(items: readonly T[], prior: readonly PriorDecision[]): Array<{ item: T; from: PriorDecision }> {
  const byKey = new Map<string, PriorDecision>();
  for (const p of prior) if (!byKey.has(key(p))) byKey.set(key(p), p);
  const out: Array<{ item: T; from: PriorDecision }> = [];
  for (const it of items) { const from = byKey.get(key(it)); if (from) out.push({ item: it, from }); }
  return out;
}

/** Apply the carry to a freshly created sitting: prior completed sittings on the same reference run, human decisions only. */
export async function carryIntoSitting(sittingId: string, referenceRunId: string): Promise<number> {
  const items = await prisma.adjudication.findMany({
    where: { sittingId, decision: null },
    select: { id: true, exampleId: true, itemIndex: true, question: true, refState: true, candState: true },
  });
  if (items.length === 0) return 0;
  const prior = await prisma.adjudication.findMany({
    where: {
      sittingId: { not: sittingId }, decision: { not: null },
      OR: [{ decisionSource: "human" }, { decisionSource: null }],
      sitting: { referenceRunId, completedAt: { not: null } },
    },
    select: { exampleId: true, itemIndex: true, question: true, refState: true, candState: true, decision: true, note: true, decidedById: true, sitting: { select: { title: true } } },
    orderBy: { decidedAt: "desc" },
  });
  const matches = matchCarried(items, prior.map((p) => ({ ...p, decision: p.decision!, sittingTitle: p.sitting.title })));
  for (const { item, from } of matches) {
    await prisma.adjudication.update({
      where: { id: item.id },
      data: {
        decision: from.decision, decisionSource: CARRIED_SOURCE,
        note: `carried from "${from.sittingTitle}"${from.note ? `: ${from.note}` : ""}`,
        agreedWithTriage: false, decidedById: from.decidedById, decidedAt: new Date(),
      },
    });
  }
  logger.info({ sittingId, items: items.length, carried: matches.length, priorPool: prior.length }, "carried prior verdicts into the sitting");
  return matches.length;
}
