/**
 * Parameter Tweak Service
 *
 * Extracts parameters from Build123d code via the external service,
 * substitutes parameter values, and orchestrates re-rendering with
 * modified parameters.
 */

import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";
import { readStorageFile, storageFileExists, writeStorageFile } from "./file-storage.service.js";
import { renderBuild123d } from "./rendering.service.js";
import { wrapInTemplate } from "../utils/workbench-code-utils.js";
import { createChatItem, updateChatItem } from "./chat.service.js";
import { notificationService } from "./notification.service.js";
import { sseService } from "./sse.service.js";

const logger = createLogger("param-tweak");

// ── Types ────────────────────────────────────────────────────────────

export interface ExtractedParameter {
  name: string;
  value: number;
  line: number;
  description: string | null;
}

export class ParameterTweakError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

// ── Parameter extraction ─────────────────────────────────────────────

/**
 * Call the Build123d service's /extract-params/ endpoint to parse
 * top-level numeric variable assignments from the given code.
 */
export async function extractParameters(code: string): Promise<ExtractedParameter[]> {
  const url = `${config.query.build123dUrl.replace(/\/$/, "")}/extract-params/`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    throw new ParameterTweakError(`Build123d extract-params unreachable: ${msg}`, 502);
  }
  clearTimeout(timer);

  const body = await response.json().catch(() => ({})) as {
    parameters?: Array<{ name?: string; value?: number; line?: number; description?: string | null }>;
    error?: string;
  };

  if (!response.ok) {
    throw new ParameterTweakError(
      `Extract-params failed: ${body.error ?? response.statusText}`,
      502,
    );
  }

  const rawParams = Array.isArray(body.parameters) ? body.parameters : [];
  return rawParams
    .filter(
      (p): p is { name: string; value: number; line: number; description: string | null } =>
        typeof p.name === "string" &&
        typeof p.value === "number" &&
        typeof p.line === "number",
    )
    .map((p) => ({
      name: p.name,
      value: p.value,
      line: p.line,
      description: p.description ?? null,
    }));
}

/**
 * Extract parameters from a stored .b123d file by contextId + assistantItemId.
 */
export async function extractParametersFromItem(
  contextId: string,
  assistantItemId: string,
): Promise<ExtractedParameter[]> {
  // Check new Phase 5 path first, then fall back to legacy path
  const newPath = `chat/${contextId}/code/${assistantItemId}.b123d`;
  const oldPath = `chat/${contextId}/${assistantItemId}.b123d`;
  const codePath = (await storageFileExists(newPath)) ? newPath : oldPath;
  let codeBuffer: Buffer;
  try {
    codeBuffer = await readStorageFile({ relativePath: codePath });
  } catch {
    return [];
  }

  const code = codeBuffer.toString("utf-8");
  if (!code.trim()) {
    return [];
  }

  return extractParameters(code);
}

// ── Parameter substitution ───────────────────────────────────────────

/**
 * Replace parameter values in raw Build123d code using line-based
 * string replacement. Only replaces assignments whose variable name
 * matches one of the provided parameter changes.
 */
export function substituteParameters(
  code: string,
  changes: Record<string, number>,
): string {
  const lines = code.split("\n");
  // Pattern: variable_name = <number> [# optional comment]
  const assignmentPattern = /^(\s*)([a-zA-Z_]\w*)\s*=\s*(-?\d+(?:\.\d+)?)\s*(#.*)?$/;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(assignmentPattern);
    if (!match) continue;

    const [, indent, name, , comment] = match;
    if (!(name in changes)) continue;

    const newValue = changes[name];
    // Format: preserve integer when possible
    const valueStr = Number.isInteger(newValue) ? String(newValue) : String(newValue);
    lines[i] = `${indent}${name} = ${valueStr}${comment ? `    ${comment}` : ""}`;
  }

  return lines.join("\n");
}

// ── Re-render orchestration ──────────────────────────────────────────

function mapExtension(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".stl")) return "stl";
  if (lower.endsWith(".step") || lower.endsWith(".stp")) return "step";
  if (lower.endsWith(".3mf")) return "3mf";
  if (lower.endsWith(".b123d")) return "b123d";
  return "bin";
}

function summarizeArtifacts(files: Array<{ path: string; filename: string }>): {
  previewStatus: "ready" | "downgraded";
  detail: string;
  previewFilePath: string | null;
} {
  const stlFile = files.find((f) => f.path.endsWith(".stl"));
  const threemfFile = files.find((f) => f.path.endsWith(".3mf"));
  const previewFile = threemfFile ?? stlFile;
  return {
    previewStatus: previewFile ? "ready" : "downgraded",
    detail: previewFile ? "Preview available" : "No STL/3MF preview",
    previewFilePath: previewFile?.path ?? null,
  };
}

/**
 * Re-render a model with modified parameters and create new chat items
 * to record the change in the conversation.
 */
export async function reRenderWithParameters(input: {
  userId: string;
  contextId: string;
  sourceAssistantItemId: string;
  parameters: Record<string, number>;
}): Promise<{ assistantItemId: string }> {
  const { userId, contextId, sourceAssistantItemId, parameters } = input;

  // 1. Read original .b123d code (check new Phase 5 path first, then legacy)
  const newCodePath = `chat/${contextId}/code/${sourceAssistantItemId}.b123d`;
  const oldCodePath = `chat/${contextId}/${sourceAssistantItemId}.b123d`;
  const codePath = (await storageFileExists(newCodePath)) ? newCodePath : oldCodePath;
  let codeBuffer: Buffer;
  try {
    codeBuffer = await readStorageFile({ relativePath: codePath });
  } catch {
    throw new ParameterTweakError("Source code file not found", 404);
  }
  const originalCode = codeBuffer.toString("utf-8");

  // 2. Extract current parameters to validate names
  const currentParams = await extractParameters(originalCode);
  const validNames = new Set(currentParams.map((p) => p.name));
  const invalidNames = Object.keys(parameters).filter((n) => !validNames.has(n));
  if (invalidNames.length > 0) {
    throw new ParameterTweakError(
      `Invalid parameter names: ${invalidNames.join(", ")}`,
      400,
    );
  }

  // 3. Substitute parameter values
  const modifiedCode = substituteParameters(originalCode, parameters);

  // 4. Create user chat item to record the parameter change
  const changedParams = Object.entries(parameters)
    .map(([name, value]) => `${name} = ${value}`)
    .join(", ");
  const userItem = await createChatItem({
    userId,
    contextId,
    role: "user",
    messages: [
      { itemType: "message", text: `Adjusted parameters: ${changedParams}`, state: "completed", stateMessage: "" },
    ],
  });

  // 5. Create pending assistant item
  const assistantItem = await createChatItem({
    userId,
    contextId,
    role: "assistant",
    messages: [{ itemType: "message", text: "Re-rendering with adjusted parameters...", state: "pending", stateMessage: "" }],
  });
  const assistantItemId = assistantItem.id;

  // Publish state update
  await publishTweakState(userId, contextId, assistantItemId, "rendering", "Re-rendering with adjusted parameters...");

  // 6. Wrap code and render
  try {
    const wrappedCode = wrapInTemplate(modifiedCode, assistantItemId);
    const renderResult = await renderBuild123d({
      code: wrappedCode,
      baseFileName: assistantItemId,
    });

    // 7. Save rendered files
    const savedFiles: Array<{ path: string; filename: string }> = [];
    for (const file of renderResult.files) {
      const ext = mapExtension(file.filename);
      const rp = `chat/${contextId}/artifacts/${assistantItemId}.${ext}`;
      await writeStorageFile({ relativePath: rp, contentBase64: file.contentBase64 });
      savedFiles.push({ path: rp, filename: file.filename });
    }

    // Save modified code as .b123d (use new Phase 5 path)
    const codeRelPath = `chat/${contextId}/code/${assistantItemId}.b123d`;
    await writeStorageFile({
      relativePath: codeRelPath,
      contentBase64: Buffer.from(modifiedCode, "utf-8").toString("base64"),
    });
    savedFiles.push({ path: codeRelPath, filename: `${assistantItemId}.b123d` });

    // 8. Update assistant item with results
    const artifact = summarizeArtifacts(savedFiles);
    const assistantMessages = [
      { itemType: "message", text: "Re-rendered with adjusted parameters.", state: "completed", stateMessage: "" },
      ...(savedFiles.length > 0 ? [{
        itemType: "3dmodel",
        text: artifact.previewStatus === "ready" ? "Generated 3D preview." : `Preview unavailable. ${artifact.detail}`,
        attachment: artifact.previewFilePath ?? "",
        state: "completed",
        stateMessage: "",
        artifact,
        files: savedFiles,
        previews: [] as Array<{ path: string; filename: string }>,
      }] : []),
      { itemType: "code", text: modifiedCode, state: "completed", stateMessage: "" },
      {
        itemType: "meta",
        text: "Parameter tweak",
        state: "completed",
        stateMessage: "",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
        artifact,
        llm: { conversationModel: "parameter-tweak", codegenModel: "parameter-tweak", vlmModel: null, evalScore: null, iterations: 0 },
        files: savedFiles,
      },
    ];

    await updateChatItem({
      userId,
      contextId,
      itemId: assistantItemId,
      messages: assistantMessages,
    });

    await publishTweakState(userId, contextId, assistantItemId, "completed", "Parameter tweak completed");
    logger.info({ contextId, assistantItemId, paramCount: Object.keys(parameters).length }, "parameter re-render completed");

    return { assistantItemId };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err: errMsg, contextId, assistantItemId }, "parameter re-render failed");

    // Update assistant item with error
    await updateChatItem({
      userId,
      contextId,
      itemId: assistantItemId,
      messages: [
        { itemType: "message", text: "Re-rendering with adjusted parameters...", state: "failed", stateMessage: "" },
        { itemType: "errormessage", text: `Re-render failed: ${errMsg}`, state: "error", stateMessage: "" },
      ],
    });

    await publishTweakState(userId, contextId, assistantItemId, "failed", errMsg);
    throw new ParameterTweakError(`Re-render failed: ${errMsg}`, 502);
  }
}

async function publishTweakState(
  userId: string,
  contextId: string,
  assistantItemId: string,
  state: string,
  detail: string,
) {
  await notificationService.publishToUser(userId, "chat.query.state", {
    contextId,
    assistantItemId,
    state,
    detail,
  });
}
