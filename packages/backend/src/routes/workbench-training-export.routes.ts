/**
 * Training data export routes — sub-router mounted on workbenchRouter.
 *
 * Endpoints:
 *   GET /export/formats              — List available export formats
 *   GET /export/training-jsonl?format=<id>
 *                                    — Dispatched export (defaults to openai-multitask)
 *   GET /export/agent-jsonl          — (legacy) Agent tool-use trajectories
 *   GET /export/spec-gen-jsonl       — (legacy) Spec generation training data
 *   GET /export/spec-enrichment-jsonl — (legacy) Spec enrichment training data
 *   GET /export/agent-tools          — Tool definitions JSON (for inspection)
 */

import { Router } from "express";
import {
  exportAgentTrainingJsonl,
  exportSpecGenTrainingJsonl,
  exportSpecEnrichmentTrainingJsonl,
  getAgentToolDefinitions,
} from "../services/workbench-training-export.service.js";
import { exportAgentSyntheticTrainingJsonl } from "../services/training-export/agent-synthetic.exporter.js";
import { listFormats, getFormat } from "../services/training-export/registry.js";
import type { ExportFormatId } from "../services/training-export/types.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("training-export-routes");

export const trainingExportRouter = Router();

function parseExportQuery(query: Record<string, unknown>) {
  const cmRaw = typeof query.commentMode === "string" ? query.commentMode : undefined;
  const commentMode =
    cmRaw === "smart" || cmRaw === "smarter" || cmRaw === "none" ? cmRaw : undefined;
  return {
    minScore: query.minScore ? Number(query.minScore) : undefined,
    categoryId: typeof query.categoryId === "string" ? query.categoryId : undefined,
    approvalOnly: query.approvalOnly !== "false",
    commentMode,
  };
}

function sendJsonl(res: import("express").Response, data: string, filename: string) {
  res.setHeader("Content-Type", "application/jsonl");
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  res.status(200).send(data);
}

trainingExportRouter.get("/export/formats", (_req, res) => {
  const formats = listFormats().map((f) => ({
    id: f.id,
    label: f.label,
    description: f.description,
    filename: f.filename,
  }));
  res.json({ formats });
});

trainingExportRouter.get("/export/training-jsonl", async (req, res) => {
  const formatId = (typeof req.query.format === "string" ? req.query.format : "openai-multitask") as ExportFormatId;
  const def = getFormat(formatId);
  if (!def) {
    res.status(400).json({ error: "Unknown format", format: formatId });
    return;
  }
  try {
    const jsonl = await def.exporter(parseExportQuery(req.query));
    sendJsonl(res, jsonl, def.filename);
  } catch (error) {
    logger.error({ err: error, formatId }, "training export failed");
    res.status(500).json({ error: "Export failed", detail: String(error) });
  }
});

trainingExportRouter.get("/export/agent-jsonl", async (req, res) => {
  try {
    const jsonl = await exportAgentTrainingJsonl(parseExportQuery(req.query));
    sendJsonl(res, jsonl, "agent-training-data.jsonl");
  } catch (error) {
    logger.error({ err: error }, "agent training export failed");
    res.status(500).json({ error: "Export failed", detail: String(error) });
  }
});

trainingExportRouter.get("/export/spec-gen-jsonl", async (req, res) => {
  try {
    const jsonl = await exportSpecGenTrainingJsonl(parseExportQuery(req.query));
    sendJsonl(res, jsonl, "spec-gen-training-data.jsonl");
  } catch (error) {
    logger.error({ err: error }, "spec-gen training export failed");
    res.status(500).json({ error: "Export failed", detail: String(error) });
  }
});

trainingExportRouter.get("/export/spec-enrichment-jsonl", async (req, res) => {
  try {
    const jsonl = await exportSpecEnrichmentTrainingJsonl(parseExportQuery(req.query));
    sendJsonl(res, jsonl, "spec-enrichment-training-data.jsonl");
  } catch (error) {
    logger.error({ err: error }, "spec-enrichment training export failed");
    res.status(500).json({ error: "Export failed", detail: String(error) });
  }
});

trainingExportRouter.get("/export/agent-synthetic-jsonl", async (req, res) => {
  try {
    const jsonl = await exportAgentSyntheticTrainingJsonl(parseExportQuery(req.query));
    sendJsonl(res, jsonl, "agent-synthetic-training-data.jsonl");
  } catch (error) {
    logger.error({ err: error }, "synthetic agent training export failed");
    res.status(500).json({ error: "Export failed", detail: String(error) });
  }
});

trainingExportRouter.get("/export/agent-tools", async (_req, res) => {
  try {
    res.json(getAgentToolDefinitions());
  } catch (error) {
    logger.error({ err: error }, "agent tools export failed");
    res.status(500).json({ error: "Export failed", detail: String(error) });
  }
});
