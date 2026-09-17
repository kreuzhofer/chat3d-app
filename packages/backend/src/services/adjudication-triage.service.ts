/**
 * The third opinion as an in-app purpose (issue #93).
 *
 * Before the human looks at a disagreement, a third model reads the item,
 * both judges' evidence and the eight stored views, and gives a would-be
 * adjudication: R / C / N with a confidence, what the views show and the
 * deciding view. It is stamped with the model that gave it and stored
 * beside the card as triage — never a decision, never counted toward the
 * bar. The model is the `adjudication_triage` purpose and may be neither
 * party to the sitting: not the reference, not the candidate.
 */
import { prisma } from "../db/prisma.js";
import { preDecideSitting } from "./adjudication-pre-decide.js";
import { createLogger } from "../utils/logger.js";
import { getLlmSemaphore } from "../utils/resource-limits.js";
import { createProviderModel, getModelForPurpose, maxOutputWithThinking, type LlmModelConfig } from "./llm-config.service.js";
import { trackedGenerateText } from "./tracked-llm.service.js";
import { resolveGuidedJsonOutput } from "./visual-eval-schema.service.js";
import type { JSONSchema7 } from "ai";
import { STANDARD_VIEWS, VIEW_LABELS, type StandardView } from "./visual-eval-views.js";
import { readStorageFile, storageFileExists } from "./file-storage.service.js";
import { generateJobId, jobs, toSummary, type BatchJob, type BatchJobSummary } from "./workbench-batch.service.js";
import { SittingError } from "./adjudication-sitting.service.js";

const logger = createLogger("triage");

export const TRIAGE_PURPOSE = "adjudication_triage" as const;

export interface TriageReading {
  verdict: "R" | "C" | "N";
  confidence: "high" | "medium" | "low";
  what: string;
  deciding_view: string;
  resolved_by: string;
}

const TRIAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "confidence", "what", "deciding_view", "resolved_by"],
  properties: {
    verdict: { type: "string", enum: ["R", "C", "N"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    what: { type: "string", description: "What the views show, one to three sentences, naming the views." },
    deciding_view: { type: "string", description: "The view or views that decide it, by their labels." },
    resolved_by: { type: "string", description: "How it was settled: the views as they are, a count and how it was made, the wording of the item, or why no render can answer it." },
  },
} as const;

export function buildTriageSystemPrompt(): string {
  return [
    "You are the third opinion in an adjudication between two visual judges of a rendered 3D CAD model.",
    "A human arbiter decides; your reading is triage that the human sees beside the card. You are not a judge and nothing you say counts toward any score.",
    "",
    "You get the prompt the model was built from, one checklist item, the reference judge's answer with its evidence, the candidate judge's answer with its evidence, and the eight stored views of the model: front, back, left, right, top, bottom, a 45° view from above and a 45° view from below.",
    "",
    "Decide who was right on this item:",
    "- R: the reference judge was right.",
    "- C: the candidate judge was right.",
    "- N: neither, or the item cannot be answered from renders — a feature below render resolution, an orientation the prompt never fixes, a lid indistinguishable from the body, a criterion that bundles several questions or leans on an undefined word, a proportion the prompt itself contradicts.",
    "",
    "Trust what the views show over either judge's description of them. Read the top view for counts and say how you counted; read the 45° views for cavities and which way they open, and say which view decided it. A judge that credits a part that is not in the scene is wrong; a judge that fails an item for a defect another item covers is wrong on this item.",
    "",
    "Answer as JSON with exactly these fields: verdict (R, C or N), confidence (high, medium or low), what (what the views show, naming them), deciding_view (the view labels that decide it), resolved_by (how it was settled: the views as they are; a count and how it was made; the wording of the item; or why no render can answer it). No other text.",
  ].join("\n");
}

export interface TriageItemInput {
  prompt: string;
  question: string;
  refState: string;
  refDetail: string;
  candState: string;
  candDetail: string;
  referenceLabel: string;
  candidateLabel: string;
}

export function buildTriageUserText(it: TriageItemInput): string {
  return [
    `Prompt the model was built from:\n${it.prompt}`,
    "",
    `Checklist item: ${it.question}`,
    "",
    `Reference judge (${it.referenceLabel}): ${it.refState.toUpperCase()} — ${it.refDetail || "(no evidence given)"}`,
    `Candidate judge (${it.candidateLabel}): ${it.candState.toUpperCase()} — ${it.candDetail || "(no evidence given)"}`,
    "",
    "The eight views follow, each labelled.",
  ].join("\n");
}

/** Parse a reading from text when the provider gave no structured output. */
export function parseTriageText(text: string): TriageReading {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("triage reply carries no JSON object");
  const obj = JSON.parse(text.slice(start, end + 1)) as Partial<TriageReading>;
  return normaliseReading(obj);
}

export function normaliseReading(obj: Partial<TriageReading>): TriageReading {
  const verdict = String(obj.verdict ?? "").trim().toUpperCase();
  if (verdict !== "R" && verdict !== "C" && verdict !== "N") throw new Error(`triage verdict is not R/C/N: ${JSON.stringify(obj.verdict)}`);
  const c = String(obj.confidence ?? "").trim().toLowerCase();
  const confidence = c === "high" || c === "medium" || c === "low" ? c : "low";
  return {
    verdict,
    confidence,
    what: String(obj.what ?? "").trim(),
    deciding_view: String(obj.deciding_view ?? "").trim(),
    resolved_by: String(obj.resolved_by ?? "").trim(),
  };
}

/** The triage model may be neither party to the sitting (issue #93). */
export function assertNotAParty(cfg: Pick<LlmModelConfig, "provider" | "modelName">, parties: Array<{ provider: string; modelName: string; role: string }>): void {
  for (const p of parties) {
    if (p.provider === cfg.provider && p.modelName === cfg.modelName) {
      throw new SittingError(`The triage model ${cfg.provider}/${cfg.modelName} is the sitting's ${p.role}; the third opinion must be a third model`, 409);
    }
  }
}

const SCREENSHOT_COLUMN: Record<StandardView, string> = {
  front: "screenshotFront", back: "screenshotBack", left: "screenshotLeft", right: "screenshotRight",
  top: "screenshotTop", bottom: "screenshotBottom", ortho_45: "screenshotOrtho45", ortho_45_bottom: "screenshotOrtho45Bottom",
};

async function loadViews(exampleId: string): Promise<Array<{ view: StandardView; base64: string }>> {
  const ex = await prisma.workbenchExample.findUnique({
    where: { id: exampleId },
    select: { screenshotFront: true, screenshotBack: true, screenshotLeft: true, screenshotRight: true, screenshotTop: true, screenshotBottom: true, screenshotOrtho45: true, screenshotOrtho45Bottom: true },
  });
  if (!ex) throw new Error(`Example ${exampleId} not found`);
  const out: Array<{ view: StandardView; base64: string }> = [];
  for (const view of STANDARD_VIEWS) {
    const path = (ex as Record<string, string | null>)[SCREENSHOT_COLUMN[view]];
    if (!path) continue;
    if (path.startsWith("data:") || path.length > 500) out.push({ view, base64: path.replace(/^data:image\/\w+;base64,/, "") });
    else if (await storageFileExists(path)) out.push({ view, base64: (await readStorageFile({ relativePath: path })).toString("base64") });
  }
  if (out.length !== STANDARD_VIEWS.length) throw new Error(`Example ${exampleId} has ${out.length} of ${STANDARD_VIEWS.length} views stored`);
  return out;
}

/**
 * A model that can think gets its own output ceiling whatever the effort
 * setting says: a provider may accept the off switch and ignore it (Nebius
 * ignores `enable_thinking:false` for Kimi K3, measured 2026-09-10), and a
 * budget sized for no reasoning then stores an empty answer as a read.
 */
export function triageOutputBudget(cfg: Pick<LlmModelConfig, "supportsThinking" | "thinkingEffort" | "maxOutputTokens">): number {
  if (cfg.supportsThinking) return Math.max(cfg.maxOutputTokens ?? 0, maxOutputWithThinking(2048, cfg), 16384);
  return maxOutputWithThinking(2048, cfg);
}

async function readOne(cfg: LlmModelConfig, input: TriageItemInput, views: Array<{ view: StandardView; base64: string }>): Promise<TriageReading> {
  const model = createProviderModel(cfg);
  const content: Array<{ type: "text"; text: string } | { type: "image"; image: string; mediaType: "image/png" }> = [
    { type: "text", text: buildTriageUserText(input) },
  ];
  for (const v of views) {
    content.push({ type: "text", text: `${VIEW_LABELS[v.view]}:` });
    content.push({ type: "image", image: v.base64, mediaType: "image/png" });
  }
  const output = resolveGuidedJsonOutput<TriageReading>(cfg, TRIAGE_SCHEMA as unknown as JSONSchema7, "triage_reading");
  const semaphore = getLlmSemaphore(cfg.provider, cfg.maxConcurrent);
  const result = await semaphore.run(() => trackedGenerateText({
    model,
    system: buildTriageSystemPrompt(),
    messages: [{ role: "user", content }],
    // A thinking model's reasoning counts against the cap and is not bounded
    // by the effort budget on an OpenAI-compatible provider (Kimi K3 hit
    // "length" with an empty answer at 1024 and, on 5 of 70 items, at 8192),
    // so a thinking model gets its own output ceiling.
    maxOutputTokens: triageOutputBudget(cfg),
    temperature: 0,
    ...(output ? { output } : {}),
  }, {
    purpose: TRIAGE_PURPOSE,
    providerName: cfg.provider,
    modelId: cfg.id,
    modelName: cfg.modelName,
    modelConfig: { costPer1mInput: cfg.costPer1mInput, costPer1mOutput: cfg.costPer1mOutput },
  }));
  // The SDK's `output` getter throws when the reply did not validate against
  // the schema (a reply wrapped in prose or a fence): fall back to the text.
  let structured: Partial<TriageReading> | undefined;
  if (output) {
    try { structured = (result as unknown as { output?: Partial<TriageReading> }).output; }
    catch (error) { logger.debug({ err: error }, "structured triage output unreadable; parsing the text"); }
  }
  if (structured) return normaliseReading(structured);
  try { return parseTriageText(result.text); }
  catch (error) {
    logger.warn({ finishReason: result.finishReason, head: result.text.slice(0, 300) }, "triage reply could not be read");
    throw error;
  }
}

export interface TriageJobOptions {
  /** Re-read items that already carry a triage (default: only the ones without). */
  redo?: boolean;
}

/** Start the triage job for a sitting: one read per item, written to the row as it lands. */
export async function startTriageJob(sittingId: string, opts: TriageJobOptions = {}): Promise<BatchJobSummary> {
  const sitting = await prisma.adjudicationSitting.findUnique({
    where: { id: sittingId },
    include: {
      items: { select: { id: true, exampleId: true, question: true, refState: true, refDetail: true, candState: true, candDetail: true, triageVerdict: true, example: { select: { promptRef: { select: { prompt: true } } } } } },
      candidateRun: { select: { model: { select: { provider: true, modelName: true } } } },
      referenceRun: { select: { model: { select: { provider: true, modelName: true } } } },
    },
  });
  if (!sitting) throw new SittingError(`Sitting ${sittingId} not found`, 404);
  if (sitting.completedAt) throw new SittingError("The sitting is completed; triage reads only open sittings", 409);
  const running = [...jobs.values()].find((j) => j.type === "batch-triage" && j.status === "running" && j.categoryId === sittingId);
  if (running) throw new SittingError(`Triage is already running for this sitting (job ${running.jobId})`, 409);

  const cfg = await getModelForPurpose(TRIAGE_PURPOSE);
  const parties: Array<{ provider: string; modelName: string; role: string }> = [];
  if (sitting.referenceRun) parties.push({ ...sitting.referenceRun.model, role: "reference" });
  if (sitting.candidateRun) parties.push({ ...sitting.candidateRun.model, role: "candidate" });
  if (sitting.candidateSource === "production") {
    const judge = await getModelForPurpose("vlm_eval");
    parties.push({ provider: judge.provider, modelName: judge.modelName, role: "candidate (the corpus's judge)" });
  }
  assertNotAParty(cfg, parties);

  const targets = sitting.items.filter((it) => opts.redo || !it.triageVerdict);
  if (targets.length === 0) throw new SittingError("Every item already carries a triage; pass redo to read them again", 409);

  const jobId = generateJobId("batch-triage");
  const job: BatchJob = {
    jobId, type: "batch-triage", categoryId: sittingId, categoryName: `Triage: ${sitting.title}`,
    status: "running", total: targets.length, completed: 0, failed: 0, skipped: 0,
    currentPromptId: null, currentPromptText: null, exampleId: null, results: [], error: null,
    createdAt: new Date().toISOString(), finishedAt: null, concurrency: 2,
    pendingPromptIds: new Set(), userId: null, abortController: new AbortController(),
  };
  jobs.set(jobId, job);
  void runTriage(job, cfg, sitting, targets);
  logger.info({ jobId, sittingId, items: targets.length, model: cfg.label }, "triage started");
  return toSummary(job);
}

type TriageTarget = { id: string; exampleId: string; question: string; refState: string; refDetail: string; candState: string; candDetail: string; example: { promptRef: { prompt: string } } };

async function runTriage(job: BatchJob, cfg: LlmModelConfig, sitting: { referenceLabel: string; candidateLabel: string }, targets: TriageTarget[]): Promise<void> {
  const queue = targets.slice();
  const worker = async () => {
    for (let it = queue.shift(); it; it = queue.shift()) {
      if (job.abortController.signal.aborted) return;
      job.exampleId = it.exampleId;
      job.currentPromptText = it.question;
      try {
        const views = await loadViews(it.exampleId);
        const reading = await readOne(cfg, {
          prompt: it.example.promptRef.prompt, question: it.question,
          refState: it.refState, refDetail: it.refDetail, candState: it.candState, candDetail: it.candDetail,
          referenceLabel: sitting.referenceLabel, candidateLabel: sitting.candidateLabel,
        }, views);
        await prisma.adjudication.update({
          where: { id: it.id },
          data: {
            triageVerdict: reading.verdict, triageConfidence: reading.confidence, triageWhat: reading.what,
            triageView: reading.deciding_view.slice(0, 120), triageResolvedBy: reading.resolved_by,
            triageModel: cfg.label, triageAt: new Date(),
          },
        });
        job.completed++;
      } catch (error) {
        job.failed++;
        logger.error({ err: error, jobId: job.jobId, itemId: it.id }, "triage read failed");
        job.results.push({ promptId: it.id, promptText: it.question, status: "error", exampleId: it.exampleId, evalScore: null, approvalStatus: null, error: error instanceof Error ? error.message : String(error) });
      }
    }
  };
  await Promise.all(Array.from({ length: job.concurrency ?? 1 }, worker));
  job.status = job.abortController.signal.aborted ? "cancelled" : job.failed > 0 && job.completed === 0 ? "failed" : "completed";
  job.finishedAt = new Date().toISOString();
  job.exampleId = null;
  job.currentPromptText = null;
  logger.info({ jobId: job.jobId, completed: job.completed, failed: job.failed, status: job.status }, "triage finished");
  // #111: the C-side readings become training labels without review.
  if (job.status === "completed" || job.completed > 0) {
    try { await preDecideSitting(job.categoryId!); } catch (error) { logger.warn({ err: error, sittingId: job.categoryId }, "pre-decision after triage failed"); }
  }
}
