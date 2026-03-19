/**
 * Agent-based codegen loop (Phase 6).
 *
 * Orchestrates the tool-use loop via Vercel AI SDK's generateText with
 * stopWhen. Tool definitions live in agent-tools.service.ts, multi-agent
 * orchestration lives in agent-multi.service.ts.
 *
 * Provider-agnostic: works with any LLM provider (Anthropic, Bedrock,
 * OpenAI, etc.) via the standard createProviderModel() path.
 */

import { stepCountIs, hasToolCall } from "ai";
import { trackedGenerateText } from "./tracked-llm.service.js";
import { createLogger } from "../utils/logger.js";
import { AgentFilesystem } from "./agent-filesystem.service.js";
import { preRetrieveReferenceKnowledge, formatReferenceSection } from "./knowledge-search.service.js";
import type { RenderedFile, ProjectFile } from "./rendering.service.js";
import {
  createProviderModel,
  buildGenerateOptions,
  calculateCostUsd,
  type LlmModelConfig,
} from "./llm-config.service.js";
import { wrapInTemplate } from "./workbench-codegen.service.js";
import {
  buildAgentSystemPrompt,
  buildFullAgentSystemPrompt,
} from "../prompts/agent-system-prompt.js";
import { buildAgentTools, type AgentEvalResult } from "./agent-tools.service.js";
import { getAutoApproveThreshold } from "./generation-settings.service.js";
import { getTraceBuilder } from "./trace-builder.service.js";

const logger = createLogger("agent-codegen");

// ── Types ──────────────────────────────────────────────────────────────

export interface AgentCodegenInput {
  promptText: string;
  interpretation?: string;
  isModification: boolean;
  baselineCode?: string;
  baseFileName: string;
  maxSteps: number;
  modelConfig: LlmModelConfig;
  /** Complexity from spec generation */
  complexity?: "simple" | "medium" | "complex";
  signal?: AbortSignal;
  /** Callback for progress updates */
  onProgress?: (state: string, detail: string) => void;
  /** Pre-populated files for the agent's filesystem (for assembly agents) */
  initialFiles?: Map<string, string>;
  /** If true, render_project tool is not available (for sub-agents) */
  disableRender?: boolean;
  /** Override system prompt (used by multi-agent orchestration) */
  systemPromptOverride?: string;
  /** Override user message (used by multi-agent orchestration) */
  userMessageOverride?: string;
  /** VLM eval threshold for the submit_result quality gate */
  evalThreshold?: number;
  /** Code assertions from spec generation (for evaluate_code tool) */
  codeAssertions?: import("./spec-generation.service.js").CodeAssertion[];
  /** Spec interpretation (for code review context) */
  specInterpretation?: string;
  /** Override trace node ID (used by multi-agent to give sub-agents unique IDs) */
  traceNodeId?: string;
  /** Override trace label */
  traceLabel?: string;
  /** Skip auto-sequence edge for this node (used for parallel sub-agents with explicit edges) */
  traceSkipAutoEdge?: boolean;
}

export interface AgentCodegenResult {
  /** Final code from main.py */
  code: string;
  /** All project files (for multi-file projects) */
  files: Array<{ path: string; content: string }>;
  /** Rendered output files (STEP, STL, 3MF) */
  renderedFiles: RenderedFile[];
  /** Whether render succeeded */
  renderSuccess: boolean;
  /** Token usage */
  usage: {
    promptTokens: number;
    completionTokens: number;
    reasoningTokens: number;
    totalCostUsd: number;
  };
  /** Number of agent steps taken */
  stepCount: number;
  /** Whether the agent explicitly submitted (vs hitting step limit) */
  submitted: boolean;
  /** VLM evaluation result (if the agent ran evaluate_model) */
  evalResult: AgentEvalResult | null;
}

// Re-export multi-agent orchestration so consumers don't need to change imports
export { runMultiAgentCodegen } from "./agent-multi.service.js";

// ── Main agent loop ────────────────────────────────────────────────────

export async function runAgentCodegen(input: AgentCodegenInput): Promise<AgentCodegenResult> {
  const {
    promptText,
    interpretation,
    isModification,
    baselineCode,
    baseFileName,
    maxSteps,
    modelConfig,
    complexity,
    signal,
    onProgress,
    initialFiles,
    disableRender,
    systemPromptOverride,
    userMessageOverride,
    evalThreshold: inputEvalThreshold,
  } = input;

  logger.info(
    { isModification, maxSteps, model: modelConfig.label, complexity, disableRender },
    "starting agent codegen loop",
  );
  logger.debug(
    { prompt: promptText },
    "agent codegen full prompt",
  );

  // Initialize virtual filesystem
  const fs = new AgentFilesystem();
  if (initialFiles && initialFiles.size > 0) {
    fs.initFromFiles(initialFiles);
  } else if (isModification && baselineCode) {
    fs.initFromCode(baselineCode);
  }

  // Build system prompt
  let systemPrompt = systemPromptOverride
    ?? (complexity === "complex"
      ? buildFullAgentSystemPrompt({ isModification })
      : buildAgentSystemPrompt({ promptText, interpretation, isModification }));

  // Pre-retrieval: inject reference knowledge into system prompt
  if (!systemPromptOverride) {
    try {
      const { references: refMatches } = await preRetrieveReferenceKnowledge(promptText, interpretation);
      if (refMatches.length > 0) {
        const refSection = formatReferenceSection(refMatches);
        systemPrompt += "\n\n" + refSection;
        logger.info({ matchCount: refMatches.length, titles: refMatches.map(m => m.title) }, "pre-retrieved reference knowledge");
      }
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "reference pre-retrieval failed, continuing without");
    }
  }

  const model = createProviderModel(modelConfig);
  const extraOpts = buildGenerateOptions(modelConfig);

  // Track state
  let submitted = false;
  let lastRenderedFiles: RenderedFile[] = [];
  let renderSuccess = false;
  let evalResult: AgentEvalResult | null = null;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalReasoningTokens = 0;

  // Load eval threshold for submit_result quality gate (caller provides pipeline-scoped value)
  const evalThreshold = inputEvalThreshold ?? await getAutoApproveThreshold("chat");

  const userMessage = userMessageOverride ?? buildAgentUserMessage(promptText, isModification, baselineCode);

  // Helper: wrap files for rendering/validation
  const wrapProjectFiles = (): ProjectFile[] => {
    return fs.getFiles().map(f => ({
      path: f.path,
      content: f.path === "main.py"
        ? wrapInTemplate(f.content, baseFileName)
        : `from build123d import *\nimport math\n${f.content}`,
    }));
  };

  // Build tools via factory
  const agentTools = buildAgentTools(
    {
      fs,
      wrapProjectFiles,
      baseFileName,
      signal,
      onProgress,
      onRenderSuccess: (files) => {
        lastRenderedFiles = files;
        renderSuccess = true;
      },
      onSubmit: () => { submitted = true; },
      getLastRenderedFiles: () => lastRenderedFiles,
      userPrompt: promptText,
      evalThreshold,
      onEvalComplete: (result) => { evalResult = result; },
      getLastEvalResult: () => evalResult,
      codeAssertions: input.codeAssertions,
      specInterpretation: input.specInterpretation ?? input.interpretation,
    },
    { disableRender },
  );

  // Run the agent loop
  const tb = getTraceBuilder();
  const agentNodeId = input.traceNodeId ?? (disableRender ? `sub-agent-${baseFileName.slice(0, 8)}` : "agent");
  const agentNodeType = disableRender ? "sub_agent" : "agent_codegen";
  const agentLabel = input.traceLabel ?? (disableRender ? "Sub-Agent" : "Agent Codegen");
  tb?.startPhase(agentNodeId, agentNodeType, agentLabel, undefined, input.traceSkipAutoEdge);
  tb?.setModel(modelConfig.label, modelConfig.provider);

  try {
    const result = await trackedGenerateText({
      model,
      system: systemPrompt,
      prompt: userMessage,
      tools: agentTools,
      stopWhen: [
        stepCountIs(maxSteps),
        hasToolCall("submit_result"),
      ],
      abortSignal: signal,
      onStepFinish: (event) => {
        const stepNum = event.stepNumber + 1;
        const usage = event.usage;

        totalPromptTokens += usage?.inputTokens ?? 0;
        totalCompletionTokens += usage?.outputTokens ?? 0;
        const providerMeta = event.providerMetadata;
        const anthropicMeta = providerMeta?.anthropic as Record<string, unknown> | undefined;
        const reasoningTokens = (anthropicMeta?.reasoningTokens as number) ?? 0;
        totalReasoningTokens += reasoningTokens;

        const toolNames = event.toolCalls.map(tc => tc.toolName);

        // Trace each step as a child node of the agent
        const stepId = `${agentNodeId}/step-${stepNum}`;
        tb?.startPhase(stepId, "agent_step", `Step ${stepNum}`, agentNodeId);
        tb?.setAgentMeta({ stepNumber: stepNum, maxSteps }, stepId);
        const stepCostUsd = calculateCostUsd(modelConfig, usage?.inputTokens ?? 0, usage?.outputTokens ?? 0);
        tb?.addUsage({
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          reasoningTokens,
          costUsd: stepCostUsd,
        }, stepId);
        for (const tc of event.toolCalls) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tcAny = tc as any;
          const toolResult = event.toolResults.find((tr: { toolCallId: string }) => tr.toolCallId === tcAny.toolCallId);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const trAny = toolResult as any;
          tb?.addToolCall({
            toolName: tcAny.toolName,
            success: !trAny || !(typeof trAny?.result === "string" && trAny.result.startsWith("Error")),
            inputSummary: JSON.stringify(tcAny.args ?? {}).slice(0, 200),
            outputSummary: typeof trAny?.result === "string" ? trAny.result.slice(0, 200) : undefined,
          }, stepId);
        }
        // Capture LLM text response (the assistant's reasoning before tool calls)
        if (event.text) {
          tb?.setLlmResponseText(event.text, stepId);
        }
        tb?.endPhase("completed", { nodeId: stepId });

        logger.info(
          { step: stepNum, maxSteps, tools: toolNames, usage: { input: usage?.inputTokens, output: usage?.outputTokens, reasoning: reasoningTokens } },
          "agent step completed",
        );
        onProgress?.("agent", `Agent step ${stepNum}/${maxSteps}: ${toolNames.join(", ") || "thinking"}`);
      },
      ...extraOpts,
    }, {
      purpose: "agent_orchestration",
      providerName: modelConfig.provider,
      modelId: modelConfig.id,
      modelName: modelConfig.modelName,
      modelConfig: { costPer1mInput: modelConfig.costPer1mInput, costPer1mOutput: modelConfig.costPer1mOutput },
    });

    const finalCode = fs.getMainCode() ?? "";
    const allFiles = fs.getFiles();
    const stepCount = result.steps.length;

    logger.info(
      {
        stepCount, submitted, renderSuccess,
        fileCount: allFiles.length, codeLength: finalCode.length,
        promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, reasoningTokens: totalReasoningTokens,
      },
      "agent codegen loop completed",
    );

    tb?.setAgentMeta({ submitted, renderSuccess, stepNumber: stepCount, maxSteps }, agentNodeId);
    tb?.endPhase("completed", { nodeId: agentNodeId });

    return {
      code: finalCode, files: allFiles, renderedFiles: lastRenderedFiles, renderSuccess,
      usage: {
        promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens,
        reasoningTokens: totalReasoningTokens,
        totalCostUsd: calculateCostUsd(modelConfig, totalPromptTokens, totalCompletionTokens),
      },
      stepCount, submitted, evalResult,
    };
  } catch (err) {
    tb?.endPhase("failed", { error: err instanceof Error ? err.message : String(err), nodeId: agentNodeId });
    if (signal?.aborted) {
      logger.info("agent codegen aborted by signal");
      return {
        code: fs.getMainCode() ?? "", files: fs.getFiles(),
        renderedFiles: lastRenderedFiles, renderSuccess,
        usage: {
          promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens,
          reasoningTokens: totalReasoningTokens,
          totalCostUsd: calculateCostUsd(modelConfig, totalPromptTokens, totalCompletionTokens),
        },
        stepCount: 0, submitted: false, evalResult,
      };
    }
    throw err;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function buildAgentUserMessage(
  promptText: string,
  isModification: boolean,
  baselineCode?: string,
): string {
  const parts: string[] = [];

  if (isModification && baselineCode) {
    parts.push("The current model code is already in main.py. View it first, then make the requested changes.");
    parts.push("");
    parts.push(`User request: ${promptText}`);
  } else {
    parts.push(`Create a Build123d model for the following request:`);
    parts.push("");
    parts.push(promptText);
    parts.push("");
    parts.push("Create main.py with your code, validate it, render it, and submit when you're satisfied with the result.");
  }

  return parts.join("\n");
}
