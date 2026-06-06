/**
 * Multi-agent orchestration for complex models (Phase 6c).
 *
 * Decomposes complex prompts into independent components, builds each
 * with a sub-agent, then assembles them with a final assembly agent.
 */

import { createLogger } from "../utils/logger.js";
import { getSubAgentMaxSteps, getRagSimilarityThreshold, getRagGapThreshold, getRagMaxExamples, isAgentSearchToolsEnabled } from "./generation-settings.service.js";
import {
  calculateCostUsd,
} from "./llm-config.service.js";
import {
  buildSubAgentSystemPrompt,
  buildAssemblyAgentSystemPrompt,
  type SubAgentExample,
} from "../prompts/agent-system-prompt.js";
import {
  runAgentCodegen,
  type AgentCodegenInput,
  type AgentCodegenResult,
} from "./agent-codegen.service.js";
import { getTraceBuilder } from "./trace-builder.service.js";
import { findSimilarExamples } from "./workbench-embeddings.service.js";
import { collectMissingExample } from "./rag-gap-collector.service.js";
import { evaluateCode, type CodeReviewResult } from "./code-eval.service.js";
import { withLlmRetry } from "../utils/llm-retry.js";
import { filterResearchForComponent, type ResearchPackage } from "./research-agent.service.js";
import { formatResearchSection } from "./research-format.service.js";
import { type SubAgentVerificationSnapshot } from "../utils/component-checklist.js";
import {
  decomposePrompt,
  type DecomposedComponent,
  type DecompositionResult,
} from "./agent-multi-parser.js";

export type { DecomposedComponent, DecompositionResult } from "./agent-multi-parser.js";

const logger = createLogger("agent-multi");

/** Minimum code review score for a component to pass to assembly. */
const COMPONENT_EVAL_THRESHOLD = 5;

// RAG thresholds loaded from global settings at runtime

// ── Multi-agent orchestration ──────────────────────────────────────────

export async function runMultiAgentCodegen(input: AgentCodegenInput): Promise<AgentCodegenResult> {
  const {
    promptText,
    interpretation,
    baseFileName,
    maxSteps,
    modelConfig,
    signal,
    onProgress,
  } = input;

  logger.info(
    { model: modelConfig.label },
    "starting multi-agent orchestration",
  );
  logger.debug({ prompt: promptText }, "multi-agent full prompt");

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalReasoningTokens = 0;
  let totalSteps = 0;

  // Step 1: Decompose the prompt
  const tb = getTraceBuilder();
  tb?.startPhase("decomp", "decomposition", "Prompt Decomposition");

  onProgress?.("decomposing", "Breaking down the model into components...");

  let decomposition: DecompositionResult;
  try {
    decomposition = await decomposePrompt(promptText, interpretation, modelConfig, input.constructionSpec);
    tb?.addUsage({
      inputTokens: decomposition.promptTokens ?? 0,
      outputTokens: decomposition.completionTokens ?? 0,
      costUsd: calculateCostUsd(modelConfig, decomposition.promptTokens ?? 0, decomposition.completionTokens ?? 0),
    });
    tb?.setModel(modelConfig.label, modelConfig.provider);
    tb?.endPhase("completed");
  } catch (err) {
    tb?.endPhase("failed", { error: err instanceof Error ? err.message : String(err) });
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "decomposition failed, falling back to single agent");
    return runAgentCodegen(input);
  }

  totalPromptTokens += decomposition.promptTokens ?? 0;
  totalCompletionTokens += decomposition.completionTokens ?? 0;

  // Step 2: Route research results to components, or fall back to per-component search
  const examplesByComponent = new Map<string, SubAgentExample[]>();
  const knowledgeByComponent = new Map<string, string>();  // formatted knowledge text per component
  let ragGapThreshold = 0.75;

  if (input.researchPackage && input.researchPackage.techniques.length > 0) {
    // Use research package — filter technique results per component
    ragGapThreshold = await getRagGapThreshold();
    for (const component of decomposition.components) {
      const filtered = filterResearchForComponent(input.researchPackage, component.description);
      examplesByComponent.set(component.name, filtered.examples);
      // Format knowledge for sub-agent prompt injection
      const knowledgeSection = formatResearchSection({ ...filtered, examples: [], gapWarnings: [] });
      if (knowledgeSection) {
        knowledgeByComponent.set(component.name, knowledgeSection);
      }
      logger.info({ component: component.name, examples: filtered.examples.length, knowledge: filtered.knowledge.length }, "routed research to component");
    }
  } else {
    // Fallback: per-component search (legacy path)
    onProgress?.("retrieving", "Finding relevant examples for components...");
    const [ragSimThreshold, gapThresh, ragMaxExamples] = await Promise.all([
      getRagSimilarityThreshold(), getRagGapThreshold(), getRagMaxExamples(),
    ]);
    ragGapThreshold = gapThresh;
    const effectiveMaxExamples = input.ragMaxExamplesOverride ?? ragMaxExamples;

    const preRetrievalResults = await Promise.all(
      decomposition.components.map(async (component) => {
        try {
          const { matches } = await findSimilarExamples(component.description, effectiveMaxExamples, undefined, input.excludePromptIds);
          const filtered = matches.filter(m => m.similarity >= ragSimThreshold);
          return { componentName: component.name, matches: filtered };
        } catch (err) {
          logger.warn({ err: err instanceof Error ? err.message : String(err), component: component.name }, "pre-retrieval failed");
          return { componentName: component.name, matches: [] as SubAgentExample[] };
        }
      }),
    );
    for (const r of preRetrievalResults) {
      examplesByComponent.set(r.componentName, r.matches);
    }

    // Detect and log RAG gaps
    for (const { componentName, matches } of preRetrievalResults) {
      const bestSimilarity = matches.length > 0 ? Math.max(...matches.map(m => m.similarity)) : 0;
      if (bestSimilarity < ragGapThreshold) {
        logger.info({ component: componentName, bestSimilarity: bestSimilarity.toFixed(2) }, "RAG gap detected");
        collectMissingExample(componentName, decomposition.components.find(c => c.name === componentName)?.description ?? componentName)
          .catch(err => logger.debug({ err: err instanceof Error ? err.message : String(err) }, "gap collection failed"));
      }
    }
  }

  // Step 3: Run sub-agents for each component (in parallel)
  const componentFiles = new Map<string, string>();
  const subAgentMaxSteps = await getSubAgentMaxSteps("workbench");

  // Per-component verification snapshots captured via onChecklistEvaluated.
  // - Read by Task 8 (assembler metadata) and Task 9 (workbench_examples persistence).
  // - If a sub-agent fails its initial eval and is retried (COMPONENT_EVAL_THRESHOLD),
  //   the second run's onChecklistEvaluated overwrites the first. Last write wins.
  //   Absence of a key means no checklist eval ran for that component.
  const subAgentVerifications: Record<string, SubAgentVerificationSnapshot> = {};

  const overallContext = `This is part of a larger model: "${promptText}".\n\nAll components:\n${decomposition.components.map(c => `- ${c.name}: ${c.description}`).join("\n")}\n\nAssembly plan: ${decomposition.assemblyNotes}`;

  onProgress?.("component", `Building ${decomposition.components.length} components in parallel...`);

  // Set up trace edges for parallel sub-agents
  const subAgentIds = decomposition.components.map(c => `sub-${c.name}`);
  for (const subId of subAgentIds) {
    tb?.addEdge("decomp", subId, "data_flow", "component spec");
  }
  for (let i = 1; i < subAgentIds.length; i++) {
    tb?.addEdge(subAgentIds[0], subAgentIds[i], "parallel");
  }

  /** Run a sub-agent with shared config. Throws on transient errors (for retry). */
  async function runSubAgent(
    component: DecomposedComponent,
    userMessage: string,
    traceId: string,
    traceLabel: string,
  ): Promise<AgentCodegenResult> {
    // Let errors propagate so withLlmRetry can catch and retry transient ones
    return await runAgentCodegen({
        promptText: component.description,
        isModification: false,
        baseFileName,
        maxSteps: subAgentMaxSteps,
        modelConfig,
        signal,
        disableRender: true,
        enableSearch: false,
        systemPromptOverride: buildSubAgentSystemPrompt({
          componentName: component.name,
          componentDescription: component.description,
          overallContext,
          relevantExamples: examplesByComponent.get(component.name) ?? [],
          gapWarning: (examplesByComponent.get(component.name)?.length ?? 0) === 0
            ? `## ⚠ No Similar Examples Found\n\nUse simple, proven Build123d patterns. Build incrementally.`
            : undefined,
          knowledgeSection: knowledgeByComponent.get(component.name),
        }),
        userMessageOverride: userMessage,
        traceNodeId: traceId,
        traceLabel,
        traceSkipAutoEdge: true,
        traceId: input.traceId,
        retrievalCollector: input.retrievalCollector,
        onProgress: (state, detail) => {
          onProgress?.(state, `[${component.name}] ${detail}`);
        },
        componentChecklist: component.componentChecklist ?? [],
        componentName: component.name,
        onChecklistEvaluated: (verification) => {
          subAgentVerifications[component.name] = {
            passedCount: verification.passedCount,
            failedCount: verification.failedCount,
            uncertainCount: verification.uncertainCount,
            failedItems: verification.results
              .filter((r) => r.verdict === "FAIL")
              .map((r) => ({ item: r.item, reasoning: r.reasoning })),
          };
        },
      });
  }

  // Build sub-agent tasks as functions (not promises) so they don't start until called
  const subAgentTasks = decomposition.components.map((component) => async () => {
    const userMessage = `Create the "${component.name}" component.\n\n${component.description}\n\nWrite a function called \`${component.name}\` in main.py that returns the Part. Validate your code, then submit when validation passes. Do NOT render.`;

    logger.info({ component: component.name, maxSteps: subAgentMaxSteps }, "starting sub-agent");

    // Run sub-agent with retry on transient failures (Bedrock throttling, timeouts)
    let subResult: AgentCodegenResult | null = null;
    try {
      subResult = await withLlmRetry(
        () => runSubAgent(component, userMessage, `sub-${component.name}`, `Sub-Agent: ${component.name}`),
        {
          provider: modelConfig.provider,
          maxRetries: 3,
          baseDelayMs: 10_000,
          maxDelayMs: 60_000,
          onRetry: (attempt, maxAttempts, delayMs, reason) => {
            onProgress?.("component", `[${component.name}] ${reason} — attempt ${attempt}/${maxAttempts}, retrying in ${Math.round(delayMs / 1000)}s...`);
          },
        },
      );
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err), component: component.name }, "sub-agent failed after retries");
      onProgress?.("component", `[${component.name}] Failed after all retry attempts`);
    }
    if (!subResult || !subResult.code.trim()) {
      logger.warn({ component: component.name }, "sub-agent produced no code");
      return;
    }

    totalPromptTokens += subResult.usage.promptTokens;
    totalCompletionTokens += subResult.usage.completionTokens;
    totalReasoningTokens += subResult.usage.reasoningTokens;
    totalSteps += subResult.stepCount;

    // Code eval gate
    let componentCode = subResult.code;
    try {
      const evalResult = await evaluateCode({ userPrompt: component.description, code: componentCode });
      totalPromptTokens += evalResult.promptTokens;
      totalCompletionTokens += evalResult.completionTokens;
      logger.info({ component: component.name, score: evalResult.score, issueCount: evalResult.issues.length }, "component code eval completed");
      const evalCost = calculateCostUsd(modelConfig, evalResult.promptTokens, evalResult.completionTokens);
      tb?.addUsage({ inputTokens: evalResult.promptTokens, outputTokens: evalResult.completionTokens, costUsd: evalCost }, `sub-${component.name}`);
      tb?.setAgentMeta({ evalScore: evalResult.score } as any, `sub-${component.name}`);

      // Retry with feedback if score too low
      if (evalResult.score < COMPONENT_EVAL_THRESHOLD && evalResult.issues.length > 0) {
        logger.info({ component: component.name, score: evalResult.score }, "component below threshold — retrying with feedback");
        const feedback = `Your previous code scored ${evalResult.score}/10.\n\nIssues:\n${evalResult.issues.map(i => `- ${i}`).join("\n")}\n\nFix these issues. Keep the same function signature.`;
        const evalRetryId = `sub-${component.name}-eval-retry`;
        tb?.addEdge(`sub-${component.name}`, evalRetryId, "sequence", "eval retry");
        const retryResult = await runSubAgent(component, feedback, evalRetryId, `Sub-Agent Eval Retry: ${component.name}`);
        if (retryResult?.code.trim()) {
          componentCode = retryResult.code;
          totalPromptTokens += retryResult.usage.promptTokens;
          totalCompletionTokens += retryResult.usage.completionTokens;
          totalReasoningTokens += retryResult.usage.reasoningTokens;
          totalSteps += retryResult.stepCount;
        }
      }
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), component: component.name }, "component code eval failed (accepting anyway)");
    }

    componentFiles.set(`components/${component.name}.py`, componentCode);
    logger.info({ component: component.name, codeLength: componentCode.length, steps: subResult.stepCount }, "component accepted");
  });

  // Run sub-agents in parallel
  await Promise.all(subAgentTasks.map(task => task()));

  // Check abort after parallel sub-agents complete. Don't fall through to the
  // single-agent fallback — the same aborted signal would just kill it
  // immediately and produce a misleading "stream failed" log. Return an
  // empty/cancelled result; the pipeline catch block will translate
  // signal.reason into the right user-facing message.
  if (signal?.aborted) {
    logger.info({ reason: (signal as AbortSignal & { reason?: unknown }).reason instanceof Error ? ((signal as AbortSignal & { reason?: Error }).reason as Error).name : "unknown" }, "multi-agent orchestration aborted after sub-agents");
    return {
      code: "",
      files: [],
      renderedFiles: [],
      renderSuccess: false,
      usage: {
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        reasoningTokens: totalReasoningTokens,
        totalCostUsd: calculateCostUsd(modelConfig, totalPromptTokens, totalCompletionTokens),
      },
      stepCount: totalSteps,
      submitted: false,
      evalResult: null,
      screenshots: [],
      conversationHistory: [],
    };
  }

  if (componentFiles.size === 0) {
    logger.warn("no components produced, falling back to single agent");
    return runAgentCodegen(input);
  }

  // Add data_flow edges from each completed sub-agent to assembly
  for (const subId of subAgentIds) {
    tb?.addEdge(subId, "assembly", "data_flow", "component code");
  }

  // Step 3: Run assembly agent
  onProgress?.("assembling", "Assembling components into final model...");

  const componentSummary = Array.from(componentFiles.entries())
    .map(([path, code]) => {
      const lines = code.split("\n");
      const funcMatch = lines.find(l => l.startsWith("def "));
      const funcSignature = funcMatch ?? "(function not found)";
      return `- \`${path}\`: ${funcSignature}`;
    })
    .join("\n");

  // Attach per-component verification snapshots (advisory metadata for the assembler).
  // Components without a snapshot (checklist skipped) are passed with verification: null,
  // which the prompt builder treats as "all passed" — consistent with the gate semantics.
  const componentsForAssembler = decomposition.components.map((c) => ({
    name: c.name,
    verification: subAgentVerifications[c.name] ?? null,
  }));

  let assemblyPrompt = buildAssemblyAgentSystemPrompt({
    originalPrompt: promptText,
    assemblyNotes: decomposition.assemblyNotes,
    componentSummary,
    components: componentsForAssembler,
  });

  // Inject research package into assembly prompt (it uses systemPromptOverride,
  // so the agent-codegen pre-retrieval path is skipped)
  if (input.researchPackage) {
    const section = formatResearchSection(input.researchPackage, input.ragMaxExamplesOverride);
    if (section) {
      assemblyPrompt += "\n\n" + section;
      logger.info({ examples: input.researchPackage.examples.length, knowledge: input.researchPackage.knowledge.length }, "injected research into assembly prompt");
    }
  }

  const assemblyMaxSteps = maxSteps;
  const componentFileList = Array.from(componentFiles.keys()).map(p => `- ${p}`).join("\n");
  const assemblyUserMessage = `Create the final model matching this user request:\n\n"${promptText}"\n\nAvailable component files:\n${componentFileList}\n\nAssembly notes: ${decomposition.assemblyNotes}\n\nView each component file to understand its function signature and dimensions, then write main.py that imports and positions them EXACTLY as the user prompt describes. Validate, render, and submit when the render succeeds.`;

  const assemblyResult = await runAgentCodegen({
    promptText: assemblyUserMessage,
    isModification: false,
    baseFileName,
    maxSteps: assemblyMaxSteps,
    modelConfig,
    signal,
    initialFiles: componentFiles,
    systemPromptOverride: assemblyPrompt,
    userMessageOverride: assemblyUserMessage,
    evalThreshold: input.evalThreshold,
    traceNodeId: "assembly",
    traceLabel: "Assembly Agent",
    retrievalCollector: input.retrievalCollector,
    onProgress: (state, detail) => {
      onProgress?.(state, `[assembly] ${detail}`);
    },
  });

  totalPromptTokens += assemblyResult.usage.promptTokens;
  totalCompletionTokens += assemblyResult.usage.completionTokens;
  totalReasoningTokens += assemblyResult.usage.reasoningTokens;
  totalSteps += assemblyResult.stepCount;

  const allFiles = assemblyResult.files;

  logger.info(
    {
      componentCount: componentFiles.size,
      assemblySteps: assemblyResult.stepCount,
      totalSteps,
      renderSuccess: assemblyResult.renderSuccess,
      fileCount: allFiles.length,
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
    },
    "multi-agent orchestration completed",
  );

  return {
    code: assemblyResult.code,
    files: allFiles,
    renderedFiles: assemblyResult.renderedFiles,
    renderSuccess: assemblyResult.renderSuccess,
    usage: {
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      reasoningTokens: totalReasoningTokens,
      totalCostUsd: calculateCostUsd(modelConfig, totalPromptTokens, totalCompletionTokens),
    },
    stepCount: totalSteps,
    submitted: assemblyResult.submitted,
    evalResult: assemblyResult.evalResult,
    screenshots: assemblyResult.screenshots,
    conversationHistory: assemblyResult.conversationHistory,
    systemPrompt: assemblyResult.systemPrompt,
  };
}

