/**
 * Adjudication sittings (issue #92): start one over a candidate/reference
 * pair, work its items, close it. Mounted under the workbench router, so it
 * inherits its admin guard.
 */
import { Router, type Request, type Response } from "express";
import {
  completeSitting, createSitting, getSitting, listSittings, recordAdjudication, SittingError,
  type CandidateSpec,
} from "../services/adjudication-sitting.service.js";
import { RunNotPairableError } from "../services/qualification-screen-load.service.js";
import { startTriageJob } from "../services/adjudication-triage.service.js";
import { preDecideSitting } from "../services/adjudication-pre-decide.js";
import { startSittingDraw } from "../services/adjudication-draw.service.js";

export const workbenchAdjudicationRouter = Router();

function fail(res: Response, error: unknown, fallback: string): void {
  if (error instanceof SittingError || error instanceof RunNotPairableError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  res.status(500).json({ error: fallback, detail: String(error) });
}

function userId(req: Request): string | null {
  return req.authUser?.id ?? null;
}

workbenchAdjudicationRouter.get("/adjudication/sittings", async (_req, res) => {
  try {
    res.json({ sittings: await listSittings() });
  } catch (error) {
    fail(res, error, "Listing sittings failed");
  }
});

workbenchAdjudicationRouter.post("/adjudication/sittings", async (req, res) => {
  try {
    const body = (req.body ?? {}) as { candidateRunId?: unknown; productionExperimentId?: unknown; referenceRunId?: unknown; title?: unknown; notes?: unknown };
    const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);
    const candidateRunId = str(body.candidateRunId);
    const productionExperimentId = str(body.productionExperimentId);
    const referenceRunId = str(body.referenceRunId);
    if (!referenceRunId) { res.status(400).json({ error: "referenceRunId is required" }); return; }
    if (!!candidateRunId === !!productionExperimentId) {
      res.status(400).json({ error: "exactly one of candidateRunId or productionExperimentId is required" });
      return;
    }
    const candidate: CandidateSpec = candidateRunId ? { runId: candidateRunId } : { productionExperimentId: productionExperimentId! };
    const sitting = await createSitting({ candidate, referenceRunId, title: str(body.title) ?? undefined, notes: str(body.notes) ?? undefined }, userId(req));
    res.status(201).json(sitting);
  } catch (error) {
    fail(res, error, "Creating the sitting failed");
  }
});

workbenchAdjudicationRouter.get("/adjudication/sittings/:id", async (req, res) => {
  try {
    res.json(await getSitting(req.params.id));
  } catch (error) {
    fail(res, error, "Loading the sitting failed");
  }
});

workbenchAdjudicationRouter.patch("/adjudication/sittings/:id/items/:itemId", async (req, res) => {
  try {
    const body = (req.body ?? {}) as { decision?: unknown; note?: unknown; agreedWithTriage?: unknown };
    if (body.decision !== null && typeof body.decision !== "string") { res.status(400).json({ error: "decision must be R, C, N or null" }); return; }
    if (body.note !== undefined && typeof body.note !== "string") { res.status(400).json({ error: "note must be a string" }); return; }
    const result = await recordAdjudication(req.params.id, req.params.itemId, {
      decision: body.decision as string | null,
      note: body.note as string | undefined,
      agreedWithTriage: body.agreedWithTriage === true,
    }, userId(req));
    res.json(result);
  } catch (error) {
    fail(res, error, "Recording the adjudication failed");
  }
});

workbenchAdjudicationRouter.post("/adjudication/sittings/:id/complete", async (req, res) => {
  try {
    const reopen = (req.body as { reopen?: unknown } | undefined)?.reopen === true;
    res.json(await completeSitting(req.params.id, reopen));
  } catch (error) {
    fail(res, error, "Completing the sitting failed");
  }
});

/** Read every open item with the triage model (issue #93); progress via GET /jobs/:jobId. */
/** Apply #108's one-sided rule to a sitting's open items (#111); idempotent. */
workbenchAdjudicationRouter.post("/adjudication/sittings/:id/pre-decide", async (req, res) => {
  try {
    res.json(await preDecideSitting(req.params.id));
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    res.status(status).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

workbenchAdjudicationRouter.post("/adjudication/sittings/:id/triage", async (req, res) => {
  try {
    const redo = (req.body as { redo?: unknown } | undefined)?.redo === true;
    res.status(202).json(await startTriageJob(req.params.id, { redo }));
  } catch (error) {
    fail(res, error, "Starting the triage failed");
  }
});

/** Draw a sitting from the corpus (issue #91): size and seed; the reference judges the draw, then the sitting opens. A job. */
workbenchAdjudicationRouter.post("/adjudication/sittings/draw", async (req, res) => {
  try {
    const body = (req.body ?? {}) as { size?: unknown; seed?: unknown; title?: unknown; triage?: unknown };
    const size = Number(body.size);
    const seed = body.seed === undefined || body.seed === null || body.seed === "" ? Math.floor(Math.random() * 1_000_000) : Number(body.seed);
    if (!Number.isFinite(size) || !Number.isFinite(seed)) { res.status(400).json({ error: "size and seed must be numbers" }); return; }
    const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : undefined;
    const uid = userId(req);
    if (!uid) { res.status(401).json({ error: "An adjudicator is required to draw a sitting" }); return; }
    res.status(202).json(await startSittingDraw({ size, seed, title, triage: body.triage !== false }, uid));
  } catch (error) {
    fail(res, error, "Drawing the sitting failed");
  }
});
