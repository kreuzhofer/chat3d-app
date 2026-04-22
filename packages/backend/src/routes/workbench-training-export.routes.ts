/**
 * Training data export routes — sub-router mounted on workbenchRouter.
 *
 * Endpoints:
 *   GET /export/training-jsonl       — Combined multi-task JSONL (all training data)
 *   GET /export/agent-jsonl          — Agent tool-use trajectories (OpenAI format)
 *   GET /export/spec-gen-jsonl       — Spec generation training data
 *   GET /export/spec-enrichment-jsonl — Spec enrichment training data
 *   GET /export/agent-tools          — Tool definitions JSON (for inspection)
 */

import { Router } from "express";
import {
  exportAgentTrainingJsonl,
  exportSpecGenTrainingJsonl,
  exportSpecEnrichmentTrainingJsonl,
  exportCombinedTrainingJsonl,
  getAgentToolDefinitions,
} from "../services/workbench-training-export.service.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("training-export-routes");

export const trainingExportRouter = Router();

function parseExportQuery(query: Record<string, unknown>) {
  return {
    minScore: query.minScore ? Number(query.minScore) : undefined,
    categoryId: typeof query.categoryId === "string" ? query.categoryId : undefined,
    approvalOnly: query.approvalOnly !== "false",
  };
}

function sendJsonl(res: import("express").Response, data: string, filename: string) {
  res.setHeader("Content-Type", "application/jsonl");
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  res.status(200).send(data);
}

trainingExportRouter.get("/export/training-jsonl", async (req, res) => {
  try {
    const jsonl = await exportCombinedTrainingJsonl(parseExportQuery(req.query));
    sendJsonl(res, jsonl, "training-data-combined.jsonl");
  } catch (error) {
    logger.error({ err: error }, "combined training export failed");
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

trainingExportRouter.get("/export/agent-tools", async (_req, res) => {
  try {
    res.json(getAgentToolDefinitions());
  } catch (error) {
    logger.error({ err: error }, "agent tools export failed");
    res.status(500).json({ error: "Export failed", detail: String(error) });
  }
});
