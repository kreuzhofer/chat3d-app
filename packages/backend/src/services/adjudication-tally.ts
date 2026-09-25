/**
 * The adjudicated terms of the qualification bar (ADR 0004), over a
 * sitting's items. Pure: takes rows, returns counts.
 *
 * Only hard pass/fail flips count. On each, the human's decision says whose
 * error it was: R (the reference was right) makes it the candidate's, C the
 * reference's; the direction of the flip says whether that error is a false
 * pass or a false fail. N items are outside both tallies.
 *
 *   candidate false passes ≤ reference false passes
 *   candidate false fails  ≤ max(2 × reference false fails, 5 % of the reference's passes)
 *
 * The absolute floor is ADR 0004's amendment of 2026-09-25 (#96/#112): a
 * lenient reference that almost never false-fails collapsed the ratio's
 * allowance to near zero (Kimi K3: 2 on the 125, allowance 4). The floor is a
 * share of the reference's passes over the sitting's whole example set, so it
 * scales with the set, not with the reference's error.
 */

export type Decision = "R" | "C" | "N";

export interface TallyItem {
  refState: string;
  candState: string;
  decision: string | null;
  /** "human" or "auto-triage" (#111); absent or null reads as human for rows before the column. */
  decisionSource?: string | null;
}

export interface AdjudicationTally {
  items: number;
  /** Hard pass/fail flips: the items the two terms are counted over. */
  hard: number;
  /** Hard flips a person decided — the only ones the terms count. */
  decided: number;
  /** Hard flips #108's rule decided (C, training labels): outside both terms, but not open. */
  autoDecided: number;
  open: number;
  n: number;
  candFalsePass: number;
  refFalsePass: number;
  candFalseFail: number;
  refFalseFail: number;
  falseFailAllowance: number;
  falsePassHolds: boolean;
  falseFailHolds: boolean;
  /** True once every hard flip carries a decision. */
  complete: boolean;
}

export function isHardFlip(it: Pick<TallyItem, "refState" | "candState">): boolean {
  const pf = (s: string) => s === "pass" || s === "fail";
  return pf(it.refState) && pf(it.candState) && it.refState !== it.candState;
}

/** ADR 0004 (amended): the false-fail allowance is never below this share of the reference's passes on the set. */
export const FALSE_FAIL_FLOOR_SHARE = 0.05;

export function falseFailAllowance(refFalseFail: number, referencePasses?: number | null): number {
  const floor = referencePasses ? Math.floor(FALSE_FAIL_FLOOR_SHARE * referencePasses) : 0;
  return Math.max(2 * refFalseFail, floor);
}

export function tallyAdjudications(items: TallyItem[], referencePasses?: number | null): AdjudicationTally {
  const t = { hard: 0, decided: 0, autoDecided: 0, n: 0, candFalsePass: 0, refFalsePass: 0, candFalseFail: 0, refFalseFail: 0 };
  for (const it of items) {
    if (!isHardFlip(it)) continue;
    t.hard++;
    const d = it.decision;
    if (d !== "R" && d !== "C" && d !== "N") continue;
    if (it.decisionSource === "auto-triage") { t.autoDecided++; continue; }
    t.decided++;
    if (d === "N") { t.n++; continue; }
    if (it.candState === "fail") {
      if (d === "R") t.candFalseFail++; else t.refFalsePass++;
    } else {
      if (d === "R") t.candFalsePass++; else t.refFalseFail++;
    }
  }
  return {
    items: items.length,
    ...t,
    open: t.hard - t.decided - t.autoDecided,
    falseFailAllowance: falseFailAllowance(t.refFalseFail, referencePasses),
    falsePassHolds: t.candFalsePass <= t.refFalsePass,
    falseFailHolds: t.candFalseFail <= falseFailAllowance(t.refFalseFail, referencePasses),
    complete: t.decided + t.autoDecided === t.hard,
  };
}

export function isDecision(x: unknown): x is Decision {
  return x === "R" || x === "C" || x === "N";
}
