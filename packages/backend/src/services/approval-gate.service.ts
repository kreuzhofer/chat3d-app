/**
 * The approval gate (ADR 0001, issue #88): the verdict is derived from the
 * stored checklist items, not from the judge's score.
 *
 * Every item must pass, across whichever evaluators answered it; an item
 * still uncertain after the zoom follow-up fails. Fewer than three items
 * and the example is not gate-eligible: it stays pending, since a verdict
 * on one or two answers is not a verdict. A failed code assertion rejects,
 * outside the item logic. The composite score stays beside the items as a
 * temporary backstop until the ADR's three conditions hold; when it leaves,
 * the gate version changes and every stored verdict is re-derived from the
 * items it was computed on. v2 (#105): the code reviewer's answers to the
 * code-routed items count beside the visual judge's. Pure: no I/O.
 */

/**
 * Stamped on every row whose verdict this rule derived, so verdicts under
 * different rules are distinguishable and re-derivable. Bump on any change
 * to the rule below — the backstop's removal above all.
 */
export const GATE_VERSION = "items-v2+backstop";

/**
 * The items the gate counts: the visual judge's answers and the code
 * reviewer's, in that order (ADR 0001, #105). Either list may be absent —
 * a row evaluated before the reviewer answered items has no code answers,
 * and is judged on the visual ones alone, as under v1.
 */
export function gateItems(visual: ReadonlyArray<GateItem> | null | undefined, code: ReadonlyArray<GateItem> | null | undefined): GateItem[] {
  return [...(visual ?? []), ...(code ?? [])];
}

/** Fewer stored items than this and the Gate cannot decide the example (ADR 0001). */
export const MIN_GATE_ITEMS = 3;

export interface GateItem {
  pass: boolean | null;
}

export interface GateInput {
  renderSuccess: boolean;
  /** Any failed code assertion rejects, unconditionally. */
  assertionsFailed: boolean;
  /** The stored item answers, across whichever evaluators answered them. */
  items: ReadonlyArray<GateItem> | null | undefined;
  /** The composite score and the threshold it must clear — the temporary backstop. */
  compositeScore: number | null;
  threshold: number;
}

export type GateReason =
  | "approved"
  | "not-rendered"
  | "assertions-failed"
  | "not-gate-eligible"
  | "item-failed"
  | "below-backstop";

export interface GateVerdict {
  /** approved → auto_approved; rejected → rejected; pending otherwise. */
  status: "auto_approved" | "pending" | "rejected";
  reason: GateReason;
  gateVersion: typeof GATE_VERSION;
  /** Items stored, and how many of them passed — the numbers the reason rests on. */
  items: number;
  passed: number;
}

export function deriveVerdict(input: GateInput): GateVerdict {
  const items = input.items ?? [];
  const passed = items.filter((i) => i.pass === true).length;
  const base = { gateVersion: GATE_VERSION, items: items.length, passed } as const;
  if (!input.renderSuccess) return { ...base, status: "pending", reason: "not-rendered" };
  if (input.assertionsFailed) return { ...base, status: "rejected", reason: "assertions-failed" };
  if (items.length < MIN_GATE_ITEMS) return { ...base, status: "pending", reason: "not-gate-eligible" };
  if (passed < items.length) return { ...base, status: "pending", reason: "item-failed" };
  if (input.compositeScore === null || input.compositeScore < input.threshold) return { ...base, status: "pending", reason: "below-backstop" };
  return { ...base, status: "auto_approved", reason: "approved" };
}
