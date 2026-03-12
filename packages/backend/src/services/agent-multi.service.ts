/**
 * Multi-agent orchestration for complex models (Phase 6c).
 *
 * Decomposes complex prompts into independent components, builds each
 * with a sub-agent, then assembles them with a final assembly agent.
 */

import { createLogger } from "../utils/logger.js";
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
    { prompt: promptText.slice(0, 80), model: modelConfig.label },
    "starting multi-agent orchestration",
  );

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalReasoningTokens = 0;
  let totalSteps = 0;

  // Step 1: Decompose the prompt
  onProgress?.("decomposing", "Breaking down the model into components...");

  let decomposition: DecompositionResult;
  try {
    decomposition = await decomposePrompt(promptText, interpretation, modelConfig);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "decomposition failed, falling back to single agent");
    return runAgentCodegen(input);
  }

  totalPromptTokens += decomposition.promptTokens;
  totalCompletionTokens += decomposition.completionTokens;

  // Step 2: Run sub-agents for each component
  const componentFiles = new Map<string, string>();
  const subAgentMaxSteps = Math.min(Math.floor(maxSteps / 2), 10);

  for (let i = 0; i < decomposition.components.length; i++) {
    const component = decomposition.components[i];
    if (signal?.aborted) break;

    onProgress?.("component", `Building component ${i + 1}/${decomposition.components.length}: ${component.name}...`);

    const overallContext = `This is part of a larger model: "${promptText}".\n\nAll components:\n${decomposition.components.map(c => `- ${c.name}: ${c.description}`).join("\n")}\n\nAssembly plan: ${decomposition.assemblyNotes}`;

    const subPrompt = buildSubAgentSystemPrompt({
      componentName: component.name,
      componentDescription: component.description,
      overallContext,
    });

    try {
      const subUserMessage = `Create the "${component.name}" component.\n\n${component.description}\n\nWrite a function called \`${component.name}\` in main.py that returns the Part. Validate your code, then submit when validation passes. Do NOT render.`;

      const subResult = await runAgentCodegen({
        promptText: component.description,
        isModification: false,
        baseFileName,
        maxSteps: subAgentMaxSteps,
        modelConfig,
        signal,
        disableRender: true,
        systemPromptOverride: subPrompt,
        userMessageOverride: subUserMessage,
        onProgress: (state, detail) => {
          onProgress?.(state, `[${component.name}] ${detail}`);
        },
      });

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
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err), component: component.name }, "sub-agent failed");
    }
  }

  if (componentFiles.size === 0) {
    logger.warn("no components produced, falling back to single agent");
    return runAgentCodegen(input);
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

  const assemblyMaxSteps = Math.min(maxSteps, 15);
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
