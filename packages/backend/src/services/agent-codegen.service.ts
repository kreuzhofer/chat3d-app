/**
 * Agent-based codegen loop (Phase 6).
 *
 * Orchestrates the tool-use loop via Vercel AI SDK's streamText with
 * stopWhen. Uses streaming to keep TCP alive for slow models. Tool
 * definitions live in agent-tools.service.ts, multi-agent
 * orchestration lives in agent-multi.service.ts.
 *
 * Provider-agnostic: works with any LLM provider (Anthropic, Bedrock,
 * OpenAI, etc.) via the standard createProviderModel() path.
 */

import { stepCountIs, type CoreMessage } from "ai";
import { trackedStreamText, trackedGenerateText, consumeStreamWithProgress } from "./tracked-llm.service.js";
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
import { wrapInTemplate } from "../utils/workbench-code-utils.js";
import {
  buildAgentSystemPrompt,
  buildFullAgentSystemPrompt,
} from "../prompts/agent-system-prompt.js";
import { buildAgentTools, type AgentEvalResult } from "./agent-tools.service.js";
import { getAutoApproveThreshold } from "./generation-settings.service.js";
import { getTraceBuilder, TraceBuilder } from "./trace-builder.service.js";
import { updateTraceIncremental } from "./trace-persistence.service.js";

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
  /** Trace row ID for incremental persistence (optional — skipped if null) */
  traceId?: string | null;
  /** Pre-compiled research package (replaces legacy preRetrieveReferenceKnowledge) */
  researchPackage?: import("./research-agent.service.js").ResearchPackage | null;
  /** Override the max workbench examples injected (for few-shot experiments). */
  ragMaxExamplesOverride?: number;
  /** Prompt IDs to exclude from RAG retrieval (experiment contamination prevention). */
  excludePromptIds?: string[];
  /** Pipeline timeout in ms — passed to LLM calls so totalMs matches the pipeline wall. */
  pipelineTimeoutMs?: number;
  /** Enable search tools (search_examples, search_knowledge, lookup_api). Default true. */
  enableSearch?: boolean;
  /** Precise geometric blueprint from spec generation — used as primary codegen instruction. */
  constructionSpec?: string;
  /** Verification checklist from spec generation (for full eval in submit_result). */
  verificationChecklist?: string[];
  /** Annotated criteria with visibility routing (for full eval in submit_result). */
  annotatedCriteria?: import("./spec-generation.service.js").AnnotatedCriterion[];
  /** Category name (for eval context). */
  categoryName?: string;
  /** Prompt complexity (for eval context). */
  promptComplexity?: number;
  /** Code eval weight for composite scoring. */
  codeEvalWeight?: number;
  /** Previous conversation messages for continuation (fix loop, retry). */
  previousMessages?: CoreMessage[];
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
  /** Screenshots from the last evaluate_model/submit_result call (reusable by post-loop). */
  screenshots: import("./stl-rendering-client.service.js").RenderedScreenshot[];
  /** Full conversation history from this run (for continuation in fix loop). */
  conversationHistory: CoreMessage[];
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

  // Inject research package or fall back to legacy pre-retrieval
  if (!systemPromptOverride) {
    if (input.researchPackage && (input.researchPackage.examples.length > 0 || input.researchPackage.knowledge.length > 0)) {
      const { formatResearchSection } = await import("./research-format.service.js");
      const researchSection = formatResearchSection(input.researchPackage, input.ragMaxExamplesOverride);
      if (researchSection) {
        systemPrompt += "\n\n" + researchSection;
        logger.info({ examples: input.researchPackage.examples.length, knowledge: input.researchPackage.knowledge.length, gaps: input.researchPackage.gapWarnings.length }, "injected research package");
      }
    } else if (input.ragMaxExamplesOverride !== 0) {
      // Fallback: legacy pre-retrieval (for chat pipeline or when research is unavailable)
      // Skipped when ragMaxExamplesOverride === 0 (zero-example experiment baseline)
      try {
        const { references: refMatches } = await preRetrieveReferenceKnowledge(promptText, interpretation);
        if (refMatches.length > 0) {
          const refSection = formatReferenceSection(refMatches);
          systemPrompt += "\n\n" + refSection;
          logger.info({ matchCount: refMatches.length, titles: refMatches.map(m => m.title) }, "pre-retrieved reference knowledge (legacy fallback)");
        }
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, "reference pre-retrieval failed, continuing without");
      }
    }
  }

  const model = createProviderModel(modelConfig);
  const extraOpts = buildGenerateOptions(modelConfig);

  // Track state
  let submitted = false;
  let lastRenderedFiles: RenderedFile[] = [];
  let renderSuccess = false;
  let evalResult: AgentEvalResult | null = null;
  let lastScreenshots: import("./stl-rendering-client.service.js").RenderedScreenshot[] = [];
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalReasoningTokens = 0;
  let completedStepCount = 0;

  // Load eval threshold for submit_result quality gate (caller provides pipeline-scoped value)
  const evalThreshold = inputEvalThreshold ?? await getAutoApproveThreshold("chat");

  const userMessage = userMessageOverride ?? buildAgentUserMessage(promptText, isModification, baselineCode, input.constructionSpec);

  // Build messages array — supports conversation continuation from previous agent runs
  const agentMessages: CoreMessage[] = input.previousMessages
    ? [...input.previousMessages, { role: "user" as const, content: userMessage }]
    : [{ role: "user" as const, content: userMessage }];

  // Helper: wrap files for rendering/validation
  const wrapProjectFiles = (): ProjectFile[] => {
    return fs.getFiles().map(f => ({
      path: f.path,
      content: f.path === "main.py"
        ? wrapInTemplate(f.content, baseFileName)
        : `from build123d import *\nimport math\n${f.content}`,
    }));
  };

  // Resolve enableSearch: explicit input > global setting
  const resolvedEnableSearch = input.enableSearch !== undefined
    ? input.enableSearch
    : await (await import("./generation-settings.service.js")).isAgentSearchToolsEnabled();

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
      onEvalComplete: (result) => { evalResult = result; lastScreenshots = result.screenshots; },
      getLastEvalResult: () => evalResult,
      codeAssertions: input.codeAssertions,
      specInterpretation: input.specInterpretation ?? input.interpretation,
      constructionSpec: input.constructionSpec,
      verificationChecklist: input.verificationChecklist,
      annotatedCriteria: input.annotatedCriteria,
      categoryName: input.categoryName,
      complexity: input.promptComplexity,
      codeEvalWeight: input.codeEvalWeight,
    },
    { disableRender, enableSearch: resolvedEnableSearch, ragMaxExamplesOverride: input.ragMaxExamplesOverride, excludePromptIds: input.excludePromptIds },
  );

  // Run the agent loop
  const tb = getTraceBuilder();
  const agentNodeId = input.traceNodeId ?? (disableRender ? `sub-agent-${baseFileName.slice(0, 8)}` : "agent");
  const agentNodeType = disableRender ? "sub_agent" : "agent_codegen";
  const agentLabel = input.traceLabel ?? (disableRender ? "Sub-Agent" : "Agent Codegen");
  tb?.startPhase(agentNodeId, agentNodeType, agentLabel, undefined, input.traceSkipAutoEdge);
  tb?.setModel(modelConfig.label, modelConfig.provider);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const commonOnStepFinish = (event: any) => {
        const stepNum = event.stepNumber + 1;
        completedStepCount = stepNum;
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

          // Extract output text — AI SDK v6 uses .output, older versions used .result
          const rawResult = trAny?.output ?? trAny?.result;
          let outputText: string | undefined;
          if (typeof rawResult === "string") {
            outputText = rawResult;
          } else if (Array.isArray(rawResult)) {
            // AI SDK sometimes wraps in [{type:"text", text:"..."}]
            const textPart = rawResult.find((p: { type?: string }) => p?.type === "text");
            outputText = textPart?.text ?? JSON.stringify(rawResult).slice(0, 500);
          } else if (rawResult != null) {
            outputText = JSON.stringify(rawResult).slice(0, 500);
          }

          // Detect failure from output content, not just tool call status
          const failPatterns = ["FAILED", "ERROR:", "error:", "not valid", "not found"];
          const outputFailed = outputText != null && failPatterns.some(p => outputText!.includes(p));

          tb?.addToolCall({
            toolName: tcAny.toolName,
            success: !outputFailed,
            inputSummary: JSON.stringify(tcAny.args ?? {}).slice(0, 200),
            outputSummary: outputText?.slice(0, 500),
          }, stepId);
        }
        // Capture LLM text response (the assistant's reasoning before tool calls)
        if (event.text) {
          tb?.setLlmResponseText(event.text, stepId);
        }
        tb?.endPhase("completed", { nodeId: stepId });
        // Incremental trace persistence after each agent step
        if (input.traceId && tb) {
          updateTraceIncremental(input.traceId, tb.snapshot());
        }

        logger.info(
          { step: stepNum, maxSteps, tools: toolNames, usage: { input: usage?.inputTokens, output: usage?.outputTokens, reasoning: reasoningTokens } },
          "agent step completed",
        );
        onProgress?.("agent", `Agent step ${stepNum}/${maxSteps}: ${toolNames.join(", ") || "thinking"}`);
  };

  const trackingMeta = {
    purpose: "agent_orchestration" as const,
    providerName: modelConfig.provider,
    modelId: modelConfig.id,
    modelName: modelConfig.modelName,
    modelConfig: { costPer1mInput: modelConfig.costPer1mInput, costPer1mOutput: modelConfig.costPer1mOutput },
  };

  try {
    let stepCount: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let resolvedSteps: any[] = [];

    if (modelConfig.streamingEnabled === false) {
      // Non-streaming path: use generateText with maxSteps for tool-use loop
      logger.info({ model: modelConfig.label }, "using non-streaming agent loop (streaming disabled for this model)");
      const genResult = await trackedGenerateText({
        model,
        system: systemPrompt,
        messages: agentMessages,
        tools: agentTools,
        maxSteps,
        abortSignal: signal,
        onStepFinish: commonOnStepFinish,
        ...extraOpts,
      }, trackingMeta, input.pipelineTimeoutMs);

      resolvedSteps = genResult.steps ?? [];
      stepCount = resolvedSteps.length || completedStepCount;
    } else {
      // Streaming path: use streamText to keep TCP alive for slow models
      const streamResult = trackedStreamText({
        model,
        system: systemPrompt,
        messages: agentMessages,
        tools: agentTools,
        stopWhen: [
          stepCountIs(maxSteps),
          (_opts: { steps: unknown[] }) => submitted,
        ],
        abortSignal: signal,
        onStepFinish: commonOnStepFinish,
        ...extraOpts,
      }, trackingMeta, input.pipelineTimeoutMs);

      const { streamErrors } = await consumeStreamWithProgress(streamResult.fullStream, {
        purpose: "agent_orchestration", modelName: modelConfig.modelName,
      });

      try {
        resolvedSteps = await streamResult.steps;
        stepCount = resolvedSteps.length;
      } catch (stepsErr) {
        const realError = streamErrors.length > 0
          ? streamErrors.join("; ")
          : (stepsErr instanceof Error ? stepsErr.message : String(stepsErr));
        logger.error({ streamErrors, err: stepsErr instanceof Error ? stepsErr.message : String(stepsErr) }, "agent codegen stream failed — no steps produced");
        tb?.endPhase("failed", {
          error: realError,
          errorInfo: { category: "stream_error", message: realError },
          nodeId: agentNodeId,
        });
        if (input.traceId && tb) {
          updateTraceIncremental(input.traceId, tb.snapshot());
        }
        throw new Error(realError);
      }
    }

    const finalCode = fs.getMainCode() ?? "";
    const allFiles = fs.getFiles();

    // Build conversation history for continuation (fix loop / retry)
    const conversationHistory = stepsToMessages(agentMessages, resolvedSteps);

    logger.info(
      {
        stepCount, submitted, renderSuccess,
        fileCount: allFiles.length, codeLength: finalCode.length,
        promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, reasoningTokens: totalReasoningTokens,
      },
      "agent codegen loop completed",
    );

    tb?.setAgentMeta({ submitted, renderSuccess: input.disableRender ? "skipped" : renderSuccess, stepNumber: stepCount, maxSteps }, agentNodeId);
    if (submitted) {
      tb?.endPhase("completed", { nodeId: agentNodeId });
    } else {
      // Distinguish between step limit vs. other reasons for not submitting
      const hitLimit = stepCount >= maxSteps;
      const msg = hitLimit
        ? `Agent reached maximum step limit (${maxSteps}) without submitting a result`
        : `Agent stopped after ${stepCount} steps without a successful submission (render or eval may have failed)`;
      logger.warn({ stepCount, maxSteps, hitLimit }, msg);
      tb?.endPhase("failed", {
        error: msg,
        errorInfo: { category: hitLimit ? "step_limit" : "no_submission", message: msg },
        nodeId: agentNodeId,
      });
    }

    return {
      code: finalCode, files: allFiles, renderedFiles: lastRenderedFiles, renderSuccess,
      usage: {
        promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens,
        reasoningTokens: totalReasoningTokens,
        totalCostUsd: calculateCostUsd(modelConfig, totalPromptTokens, totalCompletionTokens),
      },
      stepCount, submitted, evalResult, screenshots: lastScreenshots, conversationHistory,
    };
  } catch (err) {
    // Add a phantom step node when aborted before any step completed
    // so the trace shows what was happening at the time of failure
    if (tb && completedStepCount === 0) {
      const phantomId = `${agentNodeId}/step-aborted`;
      tb.startPhase(phantomId, "agent_step", "Step 1 (aborted)", agentNodeId);
      tb.setAgentMeta({ stepNumber: 1, maxSteps }, phantomId);
      const errorInfo = TraceBuilder.classifyError(err);
      tb.endPhase("failed", { error: errorInfo.message, errorInfo, nodeId: phantomId });
    }

    // Use endPhaseWithError for proper classification
    tb?.endPhaseWithError(err, { nodeId: agentNodeId });
    // Persist partial trace immediately
    if (input.traceId && tb) {
      updateTraceIncremental(input.traceId, tb.snapshot());
    }

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
        stepCount: 0, submitted: false, evalResult, screenshots: lastScreenshots, conversationHistory: agentMessages,
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
  constructionSpec?: string,
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

    if (constructionSpec) {
      parts.push("");
      parts.push("## Construction Specification");
      parts.push("");
      parts.push(constructionSpec);
      parts.push("");
      parts.push("Follow the construction specification above as your primary guide. It contains the precise geometric operations, dimensions, and positions to implement.");
    }

    parts.push("");
    parts.push("Create main.py with your code, validate it, render it, and submit when you're satisfied with the result.");
  }

  return parts.join("\n");
}

/**
 * Convert initial messages + SDK step results into a CoreMessage[] array
 * suitable for passing to the next streamText/generateText call as conversation history.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stepsToMessages(initialMessages: CoreMessage[], steps: any[]): CoreMessage[] {
  const history = [...initialMessages];
  for (const step of steps) {
    // Assistant message: text + tool calls
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const assistantContent: any[] = [];
    if (step.text) {
      assistantContent.push({ type: "text", text: step.text });
    }
    if (step.toolCalls && Array.isArray(step.toolCalls)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const tc of step.toolCalls as any[]) {
        // Sanitize: skip malformed tool calls (vLLM can produce calls without args)
        if (!tc.toolCallId || !tc.toolName) continue;
        assistantContent.push({
          type: "tool-call",
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          args: tc.args ?? {},
        });
      }
    }
    if (assistantContent.length > 0) {
      history.push({ role: "assistant", content: assistantContent });
    }
    // Tool results
    if (step.toolResults && Array.isArray(step.toolResults)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolContent = (step.toolResults as any[])
        .filter((tr: any) => tr.toolCallId) // skip malformed results
        .map((tr: any) => {
          const rawOutput = tr.result ?? tr.output ?? "";
          const textValue = typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput);
          return {
            type: "tool-result" as const,
            toolCallId: tr.toolCallId,
            toolName: tr.toolName ?? "unknown",
            output: { type: "text" as const, value: textValue },
          };
        });
      if (toolContent.length > 0) {
        history.push({ role: "tool", content: toolContent });
      }
    }
  }
  return history;
}
