/**
 * The mechanical terms of the qualification bar (ADR 0004).
 *
 * A local judge may own `vlm_eval` once it clears the bar on the fixed 125,
 * under the Instrument id it will run, against one run of the reference
 * under the same id. This module computes the terms the screen prints from
 * stored experiment rows; it decides nothing itself and touches no
 * database. The adjudicated terms (who was right where the two disagree)
 * are a human's, worked from the disagreement dump.
 *
 * - Completeness: zero tolerance on six counts, each read from the
 *   observable the pipeline stores for it (the error column, the issues
 *   text for a failed or truncated evaluation, the checklist array, the
 *   item's zoom follow-up outcome).
 * - Stability: the second arm agrees with the first at or inside the
 *   reference's own floor, on the judge's final answers (after zoom); the
 *   first-pass cut is reported beside it.
 * - Throughput and raw agreement: recorded, never gating.
 */

export type ItemState = "P" | "F" | "U";

export interface StoredChecklistItem {
  question?: string | null;
  pass?: boolean | null;
  detail?: string | null;
  /** Set by the zoom merge when a follow-up was tried and did not answer (visual-eval-zoom). */
  zoomFollowUp?: "unreadable" | "failed" | "skipped" | null;
}

export interface ScreenResultRow {
  exampleId: string;
  visualScore: number | null;
  checklistResults: StoredChecklistItem[] | null;
  error: string | null;
  issues: string[];
  instrumentId: string | null;
  thinkingEffort: string | null;
  durationMs: number | null;
  completionTokens: number | null;
}

export interface ScreenRun {
  runId: string;
  label: string;
  rows: ScreenResultRow[];
}

/** A zoom-resolved item's detail carries this prefix (visual-eval-zoom). */
export const ZOOM_PREFIX = "[2x zoom]";
/** A follow-up that was tried and did not answer: the reply unreadable, or the call failed (visual-eval-zoom). */
const FOLLOW_UP_FALLBACKS = new Set(["unreadable", "failed"]);
/** A failed evaluation is stored as a score-1 row whose first issue says so (visual-eval). */
const FAILED_EVALUATION_PREFIX = "Evaluation failed:";
/** An output budget exhausted before the answer is stored as a score-1 row naming the finish reason. */
const TRUNCATION_MARKER = 'finish reason "length"';

/** The reference's own floor: the noisier Sonnet self-pair on record (map #45, ADR 0004). */
export const STABILITY_FLOOR = { maxHardFlipRate: 0.029, minIdenticalRate: 0.9 } as const;
/** The composite backstop (ADR 0001); scores are recorded, never gating here. */
export const SCORE_GATE_THRESHOLD = 7.5;
/** Fewer items than this is not gate-eligible (ADR 0001). */
export const MIN_GATE_ITEMS = 3;

export interface Term {
  name: string;
  value: number;
  limit: number;
  comparator: "<=" | ">=";
  pass: boolean;
}

function term(name: string, value: number, comparator: "<=" | ">=", limit: number): Term {
  const pass = comparator === "<=" ? value <= limit : value >= limit;
  return { name, value, limit, comparator, pass };
}

// ── Items ────────────────────────────────────────────────────────────

export function isZoomResolved(item: StoredChecklistItem | undefined): boolean {
  return (item?.detail ?? "").startsWith(ZOOM_PREFIX);
}

/** The follow-up parser fallback the completeness term counts; a skipped follow-up (no view) is residual uncertain, not a fallback. */
export function isUnreadableFollowUp(item: StoredChecklistItem | undefined): boolean {
  return FOLLOW_UP_FALLBACKS.has(item?.zoomFollowUp ?? "");
}

/** pass → P, fail → F, anything else → U; at the first-pass cut a zoom-resolved item is U again. */
export function itemState(item: StoredChecklistItem | undefined, firstPass = false): ItemState {
  if (!item) return "U";
  if (firstPass && isZoomResolved(item)) return "U";
  return item.pass === true ? "P" : item.pass === false ? "F" : "U";
}

function isFailedEvaluation(row: ScreenResultRow): boolean {
  return row.error != null || row.issues.some((i) => i.startsWith(FAILED_EVALUATION_PREFIX));
}

function isTruncated(row: ScreenResultRow): boolean {
  return row.issues.some((i) => i.includes(TRUNCATION_MARKER));
}

function hasChecklist(row: ScreenResultRow): boolean {
  return Array.isArray(row.checklistResults) && row.checklistResults.length > 0;
}

/** Rows that answered: not failed, not truncated, with a checklist. */
function answeredRows(run: ScreenRun): Map<string, ScreenResultRow> {
  const out = new Map<string, ScreenResultRow>();
  for (const row of run.rows) {
    if (!isFailedEvaluation(row) && !isTruncated(row) && hasChecklist(row)) out.set(row.exampleId, row);
  }
  return out;
}

// ── Completeness ─────────────────────────────────────────────────────

export interface CompletenessTerms {
  selected: number;
  answered: number;
  unanswered: number;
  errors: number;
  truncations: number;
  missingChecklists: number;
  itemCountMismatches: number;
  unreadableFollowUps: number;
  /** Allowed: they fail at the gate. Recorded, not a term. */
  residualUncertain: number;
  items: number;
  terms: Term[];
  pass: boolean;
}

/**
 * Six counts at zero tolerance. Item counts are checked against the run
 * whose checklist is the yardstick (the reference, or the other arm).
 */
export function completeness(
  run: ScreenRun,
  selectedExampleIds: readonly string[],
  itemCountReference?: ScreenRun,
): CompletenessTerms {
  const byExample = new Map(run.rows.map((r) => [r.exampleId, r]));
  const refItems = new Map<string, number>();
  for (const r of itemCountReference?.rows ?? []) {
    if (hasChecklist(r)) refItems.set(r.exampleId, r.checklistResults!.length);
  }

  let unanswered = 0, errors = 0, truncations = 0, missingChecklists = 0;
  let itemCountMismatches = 0, unreadableFollowUps = 0, residualUncertain = 0, items = 0;
  for (const exampleId of selectedExampleIds) {
    const row = byExample.get(exampleId);
    if (!row) { unanswered++; continue; }
    if (isFailedEvaluation(row)) { errors++; continue; }
    if (isTruncated(row)) { truncations++; continue; }
    if (!hasChecklist(row)) { missingChecklists++; continue; }
    const checklist = row.checklistResults!;
    const expected = refItems.get(exampleId);
    if (expected !== undefined && expected !== checklist.length) itemCountMismatches++;
    for (const item of checklist) {
      items++;
      if (isUnreadableFollowUp(item)) unreadableFollowUps++;
      if (itemState(item) === "U") residualUncertain++;
    }
  }
  const answered = selectedExampleIds.length - unanswered;
  const terms = [
    term("unanswered examples", unanswered, "<=", 0),
    term("errors", errors, "<=", 0),
    term("truncations", truncations, "<=", 0),
    term("missing checklists", missingChecklists, "<=", 0),
    term("item-count mismatches", itemCountMismatches, "<=", 0),
    term("unreadable follow-ups", unreadableFollowUps, "<=", 0),
  ];
  return {
    selected: selectedExampleIds.length, answered, unanswered, errors, truncations, missingChecklists,
    itemCountMismatches, unreadableFollowUps, residualUncertain, items, terms, pass: terms.every((t) => t.pass),
  };
}

// ── Identity ─────────────────────────────────────────────────────────

export interface IdentityTerms {
  instrumentIds: string[];
  thinkingEfforts: string[];
  pass: boolean;
}

/** One Instrument id and one thinking effort across the run's answered rows. */
export function identity(run: ScreenRun): IdentityTerms {
  const ids = new Set<string>();
  const efforts = new Set<string>();
  for (const row of answeredRows(run).values()) {
    ids.add(row.instrumentId ?? "(none)");
    efforts.add(row.thinkingEffort ?? "(none)");
  }
  const instrumentIds = [...ids].sort();
  const thinkingEfforts = [...efforts].sort();
  return { instrumentIds, thinkingEfforts, pass: instrumentIds.length === 1 && thinkingEfforts.length === 1 };
}

// ── Pairing and agreement ────────────────────────────────────────────

export interface ItemPair {
  exampleId: string;
  index: number;
  question: string;
  ref: StoredChecklistItem;
  cand: StoredChecklistItem;
}

/** Items matched by example and position, on examples both runs answered; extra items on either side are dropped. */
export function pairItems(cand: ScreenRun, ref: ScreenRun): ItemPair[] {
  const candRows = answeredRows(cand);
  const refRows = answeredRows(ref);
  const pairs: ItemPair[] = [];
  for (const exampleId of [...candRows.keys()].sort()) {
    const c = candRows.get(exampleId)!;
    const r = refRows.get(exampleId);
    if (!r) continue;
    const n = Math.min(c.checklistResults!.length, r.checklistResults!.length);
    for (let i = 0; i < n; i++) {
      const ri = r.checklistResults![i];
      pairs.push({ exampleId, index: i, question: ri.question ?? c.checklistResults![i].question ?? "", ref: ri, cand: c.checklistResults![i] });
    }
  }
  return pairs;
}

export type StateMatrix = Record<ItemState, Record<ItemState, number>>;

export interface AgreementTerms {
  items: number;
  identical: number;
  identicalRate: number;
  hardFlips: number;
  hardFlipRate: number;
  eitherUncertain: number;
  refPass: number;
  refFail: number;
  candPass: number;
  candFail: number;
  /** Candidate passed where the reference failed: a raw false pass, unadjudicated. */
  candPassOnRefFail: number;
  /** Candidate failed where the reference passed: a raw false fail, unadjudicated. */
  candFailOnRefPass: number;
  /** matrix[ref][cand] */
  matrix: StateMatrix;
}

function emptyMatrix(): StateMatrix {
  return { P: { P: 0, F: 0, U: 0 }, F: { P: 0, F: 0, U: 0 }, U: { P: 0, F: 0, U: 0 } };
}

export function agreement(pairs: ItemPair[], opts: { firstPass?: boolean } = {}): AgreementTerms {
  const firstPass = opts.firstPass ?? false;
  const matrix = emptyMatrix();
  for (const p of pairs) matrix[itemState(p.ref, firstPass)][itemState(p.cand, firstPass)]++;
  const items = pairs.length;
  const identical = matrix.P.P + matrix.F.F + matrix.U.U;
  const hardFlips = matrix.P.F + matrix.F.P;
  const eitherUncertain = items - (matrix.P.P + matrix.P.F + matrix.F.P + matrix.F.F);
  const rate = (n: number) => (items ? n / items : 0);
  return {
    items, identical, identicalRate: rate(identical), hardFlips, hardFlipRate: rate(hardFlips), eitherUncertain,
    refPass: matrix.P.P + matrix.P.F + matrix.P.U, refFail: matrix.F.P + matrix.F.F + matrix.F.U,
    candPass: matrix.P.P + matrix.F.P + matrix.U.P, candFail: matrix.P.F + matrix.F.F + matrix.U.F,
    candPassOnRefFail: matrix.F.P, candFailOnRefPass: matrix.P.F, matrix,
  };
}

// ── Stability ────────────────────────────────────────────────────────

export interface StabilityTerms {
  /** The judge's final answers: the cut the terms gate on. */
  allItems: AgreementTerms;
  /** Zoom-resolved items re-opened, for comparison with the floor's own first-pass measurement. */
  firstPass: AgreementTerms;
  terms: Term[];
  pass: boolean;
}

export function stability(arm1: ScreenRun, arm2: ScreenRun): StabilityTerms {
  const pairs = pairItems(arm2, arm1);
  const allItems = agreement(pairs);
  const firstPass = agreement(pairs, { firstPass: true });
  const terms = [
    term("hard flips (arm 2 vs arm 1, all items)", allItems.hardFlipRate, "<=", STABILITY_FLOOR.maxHardFlipRate),
    term("identical items (arm 2 vs arm 1, all items)", allItems.identicalRate, ">=", STABILITY_FLOOR.minIdenticalRate),
  ];
  return { allItems, firstPass, terms, pass: terms.every((t) => t.pass) };
}

// ── Item gate (ADR 0001) ─────────────────────────────────────────────

export interface ItemGateTerms {
  eligible: number;
  agree: number;
  agreeRate: number;
  /** Candidate approves, reference rejects. */
  falseAccepts: number;
  /** Candidate rejects, reference approves. */
  falseRejects: number;
  candApproves: number;
  refApproves: number;
}

export function itemGate(cand: ScreenRun, ref: ScreenRun): ItemGateTerms {
  const candRows = answeredRows(cand);
  const refRows = answeredRows(ref);
  let eligible = 0, agree = 0, falseAccepts = 0, falseRejects = 0, candApproves = 0, refApproves = 0;
  for (const [exampleId, c] of candRows) {
    const r = refRows.get(exampleId);
    if (!r) continue;
    const cl = c.checklistResults!, rl = r.checklistResults!;
    if (cl.length < MIN_GATE_ITEMS || rl.length < MIN_GATE_ITEMS || cl.length !== rl.length) continue;
    eligible++;
    const vc = cl.every((i) => itemState(i) === "P");
    const vr = rl.every((i) => itemState(i) === "P");
    if (vc) candApproves++;
    if (vr) refApproves++;
    if (vc === vr) agree++;
    else if (vc) falseAccepts++;
    else falseRejects++;
  }
  return { eligible, agree, agreeRate: eligible ? agree / eligible : 0, falseAccepts, falseRejects, candApproves, refApproves };
}

// ── Scores ───────────────────────────────────────────────────────────

export interface ScoreTerms {
  examples: number;
  sameScore: number;
  meanAbsDelta: number;
  candMean: number;
  refMean: number;
  candPassRefFail: number;
  candFailRefPass: number;
}

/** First-pass scores, untouched by zoom; the 7.5 backstop is recorded for continuity with older comparisons. */
export function scoreAgreement(cand: ScreenRun, ref: ScreenRun): ScoreTerms {
  const candRows = answeredRows(cand);
  const refRows = answeredRows(ref);
  let examples = 0, sameScore = 0, absDelta = 0, candSum = 0, refSum = 0, candPassRefFail = 0, candFailRefPass = 0;
  for (const [exampleId, c] of candRows) {
    const r = refRows.get(exampleId);
    if (!r || c.visualScore == null || r.visualScore == null) continue;
    examples++;
    if (c.visualScore === r.visualScore) sameScore++;
    absDelta += Math.abs(c.visualScore - r.visualScore);
    candSum += c.visualScore;
    refSum += r.visualScore;
    const gc = c.visualScore >= SCORE_GATE_THRESHOLD, gr = r.visualScore >= SCORE_GATE_THRESHOLD;
    if (gc && !gr) candPassRefFail++;
    if (!gc && gr) candFailRefPass++;
  }
  const mean = (s: number) => (examples ? s / examples : 0);
  return { examples, sameScore, meanAbsDelta: mean(absDelta), candMean: mean(candSum), refMean: mean(refSum), candPassRefFail, candFailRefPass };
}

// ── Throughput ───────────────────────────────────────────────────────

export interface ThroughputTerms {
  examples: number;
  secondsPerExample: number;
  outputTokensPerExample: number;
  /** One judge, one example at a time. */
  hoursPerCorpusSequential: number;
  wallClockMinutes: number | null;
  /** At the run's own wall-clock rate (its concurrency and pool). */
  hoursPerCorpusAtRunRate: number | null;
}

export function throughput(run: ScreenRun, corpusSize: number, wallClockMs?: number): ThroughputTerms {
  const rows = [...answeredRows(run).values()];
  const examples = rows.length;
  const secondsPerExample = examples ? rows.reduce((s, r) => s + (r.durationMs ?? 0), 0) / examples / 1000 : 0;
  const outputTokensPerExample = examples ? rows.reduce((s, r) => s + (r.completionTokens ?? 0), 0) / examples : 0;
  const wallClockMinutes = wallClockMs != null ? wallClockMs / 60_000 : null;
  const hoursPerCorpusAtRunRate = wallClockMs != null && examples ? (wallClockMs / examples) * corpusSize / 3_600_000 : null;
  return {
    examples, secondsPerExample, outputTokensPerExample,
    hoursPerCorpusSequential: (secondsPerExample * corpusSize) / 3600,
    wallClockMinutes, hoursPerCorpusAtRunRate,
  };
}
