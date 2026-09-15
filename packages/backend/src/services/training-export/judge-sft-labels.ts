/**
 * The judge training export's labels (issue #94) — pure.
 *
 * The map decided two label sources and nothing else:
 *   (a) adjudicated R/C verdicts — the correction signal; the evidence is
 *       whichever judge was right (the reference's on R, the candidate's on C);
 *   (b) items where candidate and reference agree — the regularising set,
 *       capped at about three passes per fail.
 * Never the reference's unadjudicated disagreements, never N items, never an
 * item whose "right" answer was uncertain (nothing to learn).
 */
import { itemState, ZOOM_PREFIX, type ItemPair, type StoredChecklistItem } from "../qualification-screen.service.js";

export type LabelSource = "adjudicated" | "agreed";
export type Decision = "R" | "C" | "N";

export interface LabelledItem {
  exampleId: string;
  /** Position in the judges' checklist (0-based), the pairing key. */
  index: number;
  question: string;
  pass: boolean;
  /** `<view(s) checked>: <what was seen>`, from whichever judge was right. */
  detail: string;
  source: LabelSource;
  decision: "R" | "C" | null;
  sittingId: string;
}

export interface DecisionRecord {
  itemIndex: number;
  exampleId: string;
  question: string;
  decision: Decision;
}

export interface LabelDrops {
  /** Disagreements no adjudication has decided yet. */
  open: number;
  /** Decided N: neither judge, or unanswerable from renders. */
  neither: number;
  /** Both judges uncertain, or the judge that was right had said uncertain. */
  uncertain: number;
  /** Adjudicated, but the item's question has since been regenerated (#89): the verdict no longer has an item. */
  orphaned: number;
}

export const decisionKey = (exampleId: string, index: number): string => `${exampleId}:${index}`;

/** The stored detail without the zoom merge's prefix: a single-turn judge cannot produce it. */
export function cleanDetail(item: StoredChecklistItem): string {
  const d = (item.detail ?? "").trim();
  return d.startsWith(ZOOM_PREFIX) ? d.slice(ZOOM_PREFIX.length).trim() : d;
}

/**
 * Label every paired item of one sitting. An adjudication whose question no
 * longer matches the item at its index is **orphaned** — the candidate side
 * of a drawn sitting is read live from the corpus, and a regenerated
 * checklist (#89) has replaced the question the verdict was about. It is
 * dropped and counted, never re-paired onto the new question.
 */
export function labelPairs(
  pairs: ItemPair[],
  decisions: Map<string, DecisionRecord>,
  sittingId: string,
): { items: LabelledItem[]; drops: LabelDrops } {
  const items: LabelledItem[] = [];
  const drops: LabelDrops = { open: 0, neither: 0, uncertain: 0, orphaned: 0 };
  for (const p of pairs) {
    const d = decisions.get(decisionKey(p.exampleId, p.index));
    const refState = itemState(p.ref);
    const candState = itemState(p.cand);
    if (d) {
      if (d.question.trim() !== p.question.trim()) { drops.orphaned++; continue; }
      if (d.decision === "N") { drops.neither++; continue; }
      const right = d.decision === "R" ? p.ref : p.cand;
      if (typeof right.pass !== "boolean") { drops.uncertain++; continue; }
      items.push({
        exampleId: p.exampleId, index: p.index, question: p.question, pass: right.pass,
        detail: cleanDetail(right), source: "adjudicated", decision: d.decision, sittingId,
      });
      continue;
    }
    if (refState !== candState) { drops.open++; continue; }
    if (refState === "U" || typeof p.ref.pass !== "boolean") { drops.uncertain++; continue; }
    items.push({
      exampleId: p.exampleId, index: p.index, question: p.question, pass: p.ref.pass,
      detail: cleanDetail(p.ref), source: "agreed", decision: null, sittingId,
    });
  }
  return { items, drops };
}

export interface CapReport {
  passesPerFail: number;
  fails: number;
  agreedPassesAvailable: number;
  agreedPassesKept: number;
}

/**
 * Keep every fail and every adjudicated item; keep at most `passesPerFail`
 * agreed passes per fail, chosen by `draw` (seeded on the caller's side so
 * the export is reproducible).
 */
export function capAgreedPasses(
  items: LabelledItem[],
  passesPerFail: number,
  draw: (keys: string[], n: number) => string[],
): { items: LabelledItem[]; cap: CapReport } {
  const fails = items.filter((i) => !i.pass).length;
  const agreedPasses = items.filter((i) => i.source === "agreed" && i.pass);
  const budget = Math.min(agreedPasses.length, Math.round(passesPerFail * fails));
  const keys = agreedPasses.map((i) => decisionKey(i.exampleId, i.index)).sort();
  const kept = new Set(budget < agreedPasses.length ? draw(keys, budget) : keys);
  const out = items.filter((i) => !(i.source === "agreed" && i.pass) || kept.has(decisionKey(i.exampleId, i.index)));
  return {
    items: out,
    cap: { passesPerFail, fails, agreedPassesAvailable: agreedPasses.length, agreedPassesKept: kept.size },
  };
}

/**
 * Merge the sittings' items by (example, index): an adjudicated label beats
 * an agreed one; two adjudicated labels that disagree are an error, not a
 * choice.
 */
export function mergeLabels(all: LabelledItem[]): LabelledItem[] {
  const byKey = new Map<string, LabelledItem>();
  for (const item of all) {
    const key = decisionKey(item.exampleId, item.index);
    const have = byKey.get(key);
    if (!have) { byKey.set(key, item); continue; }
    if (have.source === "adjudicated" && item.source === "adjudicated" && have.pass !== item.pass) {
      throw new Error(`Conflicting adjudications on ${item.exampleId} item ${item.index}: sittings ${have.sittingId} and ${item.sittingId}`);
    }
    if (have.source === "agreed" && item.source === "adjudicated") byKey.set(key, item);
  }
  return [...byKey.values()].sort((a, b) => a.exampleId.localeCompare(b.exampleId) || a.index - b.index);
}
