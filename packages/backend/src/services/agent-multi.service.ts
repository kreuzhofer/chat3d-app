/**
 * Multi-agent orchestration for complex models (Phase 6c).
 *
 * Decomposes complex prompts into independent components, builds each
 * with a sub-agent, then assembles them with a final assembly agent.
 */

import { createLogger } from "../utils/logger.js";
import { getSubAgentMaxSteps } from "./generation-settings.service.js";
import { trackedGenerateText } from "./tracked-llm.service.js";
import {
  createProviderModel,
  calculateCostUsd,
  type LlmModelConfig,
} from "./llm-config.service.js";
import {
  buildSubAgentSystemPrompt,
  buildAssemblyAgentSystemPrompt,
} from "../prompts/agent-system-prompt.js";
import {
  runAgentCodegen,
  type AgentCodegenInput,
  type AgentCodegenResult,
} from "./agent-codegen.service.js";
import { getTraceBuilder } from "./trace-builder.service.js";

const logger = createLogger("agent-multi");

// ── Types ──────────────────────────────────────────────────────────────

interface DecomposedComponent {
  name: string;
  description: string;
}

interface DecompositionResult {
  components: DecomposedComponent[];
  assemblyNotes: string;
  promptTokens: number;
  completionTokens: number;
}

// ── Decomposition ──────────────────────────────────────────────────────

async function decomposePrompt(
  promptText: string,
  interpretation: string | undefined,
  modelConfig: LlmModelConfig,
): Promise<DecompositionResult> {
  const model = createProviderModel(modelConfig);

  const systemPrompt = `You are a 3D CAD architect. Given a description of a complex 3D model, decompose it into independent components that can be built separately and assembled.

Rules:
- Each component must be a self-contained 3D part (solid body)
- Components should be geometrically independent (buildable without reference to others)
- Include key dimensions in each component description (keep descriptions under 100 words)
- Keep the number of components between 2 and 5
- Each component name must be a valid Python identifier (snake_case, no spaces)
- Assembly notes: brief positioning instructions (under 50 words)

Respond with raw JSON only. No markdown, no code fences, no explanation:
{"components":[{"name":"component_name","description":"Brief description with dimensions"}],"assemblyNotes":"Brief positioning instructions"}`;

  const fullPrompt = interpretation
    ? `User request: ${promptText}\n\nInterpretation: ${interpretation}`
    : promptText;

  const result = await trackedGenerateText({
    model,
    system: systemPrompt,
    prompt: fullPrompt,
    maxOutputTokens: 2048,
  }, {
    purpose: "agent_decomposition",
    providerName: modelConfig.provider,
    modelId: modelConfig.id,
    modelName: modelConfig.modelName,
    modelConfig: { costPer1mInput: modelConfig.costPer1mInput, costPer1mOutput: modelConfig.costPer1mOutput },
  });

  const promptTokens = result.usage?.inputTokens ?? 0;
  const completionTokens = result.usage?.outputTokens ?? 0;

  try {
    const cleanText = result.text
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```\s*$/m, "")
      .trim();
    const parsed = JSON.parse(cleanText) as { components: DecomposedComponent[]; assemblyNotes: string };

    if (!Array.isArray(parsed.components) || parsed.components.length < 2) {
      throw new Error("Decomposition produced fewer than 2 components");
    }

    for (const c of parsed.components) {
      c.name = c.name.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
    }

    logger.info(
      { componentCount: parsed.components.length, components: parsed.components.map(c => c.name) },
      "prompt decomposed into components",
    );

    return {
      components: parsed.components,
      assemblyNotes: parsed.assemblyNotes || "",
      promptTokens,
      completionTokens,
    };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), text: result.text.slice(0, 200) }, "decomposition parsing failed");
    throw new Error(`Failed to decompose prompt: ${err instanceof Error ? err.message : String(err)}`);
  }
}

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
    decomposition = await decomposePrompt(promptText, interpretation, modelConfig);
    tb?.addUsage({
      inputTokens: decomposition.promptTokens,
      outputTokens: decomposition.completionTokens,
      costUsd: calculateCostUsd(modelConfig, decomposition.promptTokens, decomposition.completionTokens),
    });
    tb?.setModel(modelConfig.label, modelConfig.provider);
    tb?.endPhase("completed");
  } catch (err) {
    tb?.endPhase("failed", { error: err instanceof Error ? err.message : String(err) });
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "decomposition failed, falling back to single agent");
    return runAgentCodegen(input);
  }

  totalPromptTokens += decomposition.promptTokens;
  totalCompletionTokens += decomposition.completionTokens;

  // Step 2: Run sub-agents for each component (in parallel)
  const componentFiles = new Map<string, string>();
  const subAgentMaxSteps = await getSubAgentMaxSteps("workbench");

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

  const subAgentPromises = decomposition.components.map((component) => {
    const subPrompt = buildSubAgentSystemPrompt({
      componentName: component.name,
      componentDescription: component.description,
      overallContext,
    });

    const subUserMessage = `Create the "${component.name}" component.\n\n${component.description}\n\nWrite a function called \`${component.name}\` in main.py that returns the Part. Validate your code, then submit when validation passes. Do NOT render.`;

    logger.info({ component: component.name, maxSteps: subAgentMaxSteps }, "starting sub-agent");

    return runAgentCodegen({
      promptText: component.description,
      isModification: false,
      baseFileName,
      maxSteps: subAgentMaxSteps,
      modelConfig,
      signal,
      disableRender: true,
      systemPromptOverride: subPrompt,
      userMessageOverride: subUserMessage,
      traceNodeId: `sub-${component.name}`,
      traceLabel: `Sub-Agent: ${component.name}`,
      traceSkipAutoEdge: true,
      onProgress: (state, detail) => {
        onProgress?.(state, `[${component.name}] ${detail}`);
      },
    }).then((subResult) => {
      totalPromptTokens += subResult.usage.promptTokens;
      totalCompletionTokens += subResult.usage.completionTokens;
      totalReasoningTokens += subResult.usage.reasoningTokens;
      totalSteps += subResult.stepCount;

      if (subResult.code.trim()) {
        componentFiles.set(`components/${component.name}.py`, subResult.code);
        logger.info(
          { component: component.name, codeLength: subResult.code.length, steps: subResult.stepCount },
          "sub-agent completed component",
        );
      } else {
        logger.warn({ component: component.name }, "sub-agent produced no code");
      }
    }).catch((err) => {
      logger.error({ err: err instanceof Error ? err.message : String(err), component: component.name }, "sub-agent failed");
    });
  });

  await Promise.all(subAgentPromises);

  // Check abort after parallel sub-agents complete
  if (signal?.aborted) {
    logger.info("multi-agent orchestration aborted after sub-agents");
    return runAgentCodegen(input); // fallback won't run either due to abort
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

  const assemblyPrompt = buildAssemblyAgentSystemPrompt({
    originalPrompt: promptText,
    assemblyNotes: decomposition.assemblyNotes,
    componentSummary,
  });

  const assemblyMaxSteps = maxSteps;
  const componentFileList = Array.from(componentFiles.keys()).map(p => `- ${p}`).join("\n");
  const assemblyUserMessage = `Assemble the components into the complete model.\n\nAvailable component files:\n${componentFileList}\n\nView each component file to understand its function signature and dimensions, then write main.py that imports and assembles them. Validate, render, and submit when the render succeeds.`;

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
  };
}
