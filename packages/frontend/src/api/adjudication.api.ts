/**
 * Adjudication sittings API client (issue #92): start a sitting over a
 * candidate/reference pair, work its items, close it.
 */

const BASE = "/api/admin/workbench/adjudication";

async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (response.status === 204) return {} as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error ?? "Request failed");
  return body as T;
}

// ── Types ───────────────────────────────────────────────────────────

export type ItemState = "pass" | "fail" | "uncertain";
export type Decision = "R" | "C" | "N";

export interface AdjudicationTally {
  items: number;
  hard: number;
  decided: number;
  open: number;
  n: number;
  candFalsePass: number;
  refFalsePass: number;
  candFalseFail: number;
  refFalseFail: number;
  falseFailAllowance: number;
  falsePassHolds: boolean;
  falseFailHolds: boolean;
  complete: boolean;
}

export interface SittingSummary {
  id: string;
  title: string;
  instrumentId: string;
  candidateSource: "run" | "production";
  candidateRunId: string | null;
  candidateLabel: string;
  referenceRunId: string | null;
  referenceLabel: string;
  sampleExperimentId: string | null;
  origin: "app" | "import";
  notes: string | null;
  itemCount: number;
  exampleCount: number;
  createdAt: string;
  completedAt: string | null;
  adjudicator: { id: string; displayName: string | null; email: string } | null;
  tally: AdjudicationTally;
}

export interface Triage {
  verdict: Decision;
  confidence: string | null;
  what: string | null;
  view: string | null;
  resolvedBy: string | null;
  model: string | null;
  at: string | null;
}

export interface SittingItem {
  id: string;
  exampleId: string;
  itemIndex: number;
  question: string;
  prompt: string;
  category: string;
  refState: ItemState;
  refDetail: string;
  candState: ItemState;
  candDetail: string;
  arm2State: ItemState | null;
  arm2Detail: string | null;
  decision: Decision | null;
  note: string;
  /** "human" or "auto-triage": #108's one-sided rule pre-decided it (#111). */
  decisionSource?: string | null;
  agreedWithTriage: boolean;
  decidedAt: string | null;
  triage: Triage | null;
}

export interface Sitting extends SittingSummary {
  items: SittingItem[];
}

export interface CreateSittingInput {
  referenceRunId: string;
  candidateRunId?: string;
  productionExperimentId?: string;
  title?: string;
  notes?: string;
}

export interface DecisionInput {
  decision: Decision | null;
  note?: string;
  agreedWithTriage?: boolean;
}

// ── Calls ───────────────────────────────────────────────────────────

export async function listSittings(token: string): Promise<{ sittings: SittingSummary[] }> {
  return request(token, "/sittings");
}

export async function createSitting(token: string, input: CreateSittingInput): Promise<Sitting> {
  return request(token, "/sittings", { method: "POST", body: JSON.stringify(input) });
}

export async function getSitting(token: string, id: string): Promise<Sitting> {
  return request(token, `/sittings/${id}`);
}

export async function recordDecision(token: string, sittingId: string, itemId: string, input: DecisionInput): Promise<{ item: Pick<SittingItem, "id" | "decision" | "note" | "agreedWithTriage" | "decidedAt">; tally: AdjudicationTally }> {
  return request(token, `/sittings/${sittingId}/items/${itemId}`, { method: "PATCH", body: JSON.stringify(input) });
}

export async function completeSitting(token: string, id: string, reopen = false): Promise<Sitting> {
  return request(token, `/sittings/${id}/complete`, { method: "POST", body: JSON.stringify({ reopen }) });
}

/** Draw a sitting from the corpus (issue #91): the reference judges the draw, then the sitting opens; a job whose `sittingId` is set at the end. */
export async function startSittingDraw(token: string, input: { size: number; seed?: number; title?: string; triage?: boolean }): Promise<{ jobId: string; status: string; total: number; completed: number; categoryId: string; sittingId: string | null }> {
  return request(token, `/sittings/draw`, { method: "POST", body: JSON.stringify(input) });
}

/** Read every open item with the triage model (issue #93); returns the job to poll via the workbench jobs route. */
export async function startTriage(token: string, id: string, redo = false): Promise<{ jobId: string; status: string; total: number; completed: number; failed: number }> {
  return request(token, `/sittings/${id}/triage`, { method: "POST", body: JSON.stringify({ redo }) });
}

// ── Display helpers ─────────────────────────────────────────────────

export type Direction = "cand-fails" | "cand-passes" | "one-uncertain";

export function itemDirection(it: Pick<SittingItem, "refState" | "candState">): Direction {
  if (it.refState === "uncertain" || it.candState === "uncertain") return "one-uncertain";
  return it.candState === "fail" ? "cand-fails" : "cand-passes";
}

export const DIRECTION_LABEL: Record<Direction, string> = {
  "cand-fails": "candidate fails · reference passes",
  "cand-passes": "candidate passes · reference fails",
  "one-uncertain": "one side uncertain",
};

export const VIEW_ORDER = ["front", "back", "left", "right", "top", "bottom", "ortho_45", "ortho_45_bottom"] as const;
export type ViewName = (typeof VIEW_ORDER)[number];
export const VIEW_LABEL: Record<ViewName, string> = {
  front: "Front", back: "Back", left: "Left", right: "Right", top: "Top", bottom: "Bottom", ortho_45: "45° down", ortho_45_bottom: "45° up",
};

/** "Careful look first": items without triage, then low-confidence, then the rest. */
export function carefulLookRank(it: Pick<SittingItem, "triage">): number {
  if (!it.triage) return 0;
  const c = (it.triage.confidence ?? "").toLowerCase();
  if (c.startsWith("low")) return 1;
  if (c.startsWith("med")) return 2;
  return 3;
}
