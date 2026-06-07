/**
 * Decomposition response parser and LLM call for the multi-agent pipeline (Task 6).
 *
 * Extracted from agent-multi.service.ts to keep that file under the 500-line cap.
 * Contains: types, constants, parser, and the decomposePrompt LLM call.
 */

import { createLogger } from "../utils/logger.js";
import { parseComponentChecklist, type ComponentChecklistItem } from "../utils/component-checklist.js";
import { trackedGenerateText } from "./tracked-llm.service.js";
import {
  createProviderModel,
  buildGenerateOptions,
  maxOutputWithThinking,
  type LlmModelConfig,
} from "./llm-config.service.js";

const logger = createLogger("agent-multi-parser");

// ── Types ──────────────────────────────────────────────────────────────

export interface DecomposedComponent {
  name: string;
  description: string;
  componentChecklist?: ComponentChecklistItem[];
}

export interface DecompositionResult {
  components: DecomposedComponent[];
  assemblyNotes: string;
  promptTokens?: number;
  completionTokens?: number;
}

// ── Constants ──────────────────────────────────────────────────────────

export const DECOMPOSE_CHECKLIST_ADDENDUM = `
For each component, also emit a "componentChecklist" — 3–6 short verification items that this component ALONE (before assembly) must satisfy. Each item should be checkable against just this component's geometry, not the assembled whole. Annotate each item with "visibility": "visual" | "code" | "both" using the same rules as the top-level verificationChecklist (visual = visible from rendered views; code = checkable in source; both = both). Include items that catch failures specific to this component's role (e.g. "is hollow", "has N standoffs", "wall thickness X mm"). Do NOT include items that depend on the relationship between components (those belong in assemblyNotes).

For each item, ALSO emit "assemblyVisibility":
  - "visible" if the feature remains externally visible in the final assembled object
    (e.g. external dimensions, port cutouts, surface features on the outer skin).
  - "occluded" if the feature is hidden inside the assembly or covered by other
    components (e.g. hollow interior of a case body once the lid is on, screw threads
    inside a tapped hole, PCB-mounting standoffs covered by the PCB).

Default to "visible" when unsure. The dispatcher uses this to skip VLM verification
for occluded items (visual evaluation cannot see hidden features) and rely on
code-eval instead.
`.trim();

// ── Parser ─────────────────────────────────────────────────────────────

/**
 * Parse a raw JSON string returned by the decomposition LLM into a
 * DecompositionResult. Exported for unit testing.
 */
export function parseDecompositionResponse(rawText: string): DecompositionResult {
  const cleanText = rawText
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();
  const parsed = JSON.parse(cleanText) as { components: unknown[]; assemblyNotes: unknown };

  if (!Array.isArray(parsed.components) || parsed.components.length < 1) {
    throw new Error("Decomposition produced no components");
  }

  const components: DecomposedComponent[] = (parsed.components as any[]).map((c: any) => {
    let name = String(c.name ?? "").replace(/[^a-z0-9_]/gi, "_").toLowerCase();
    if (/^\d/.test(name)) name = "_" + name;
    const description = String(c.description ?? "").trim();
    const checklistRaw = parseComponentChecklist(c.componentChecklist);
    return {
      name,
      description,
      ...(checklistRaw !== null ? { componentChecklist: checklistRaw } : {}),
    };
  });

  return {
    components,
    assemblyNotes: String(parsed.assemblyNotes ?? ""),
  };
}

// ── LLM call ───────────────────────────────────────────────────────────

/**
 * Call the decomposition LLM to split a prompt into independent components.
 * Moved here from agent-multi.service.ts so it lives alongside the parser,
 * types, and addendum constant it depends on.
 */
export async function decomposePrompt(
  promptText: string,
  interpretation: string | undefined,
  modelConfig: LlmModelConfig,
  constructionSpec?: string,
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

${DECOMPOSE_CHECKLIST_ADDENDUM}

Respond with raw JSON only. No markdown, no code fences, no explanation:
{"components":[{"name":"component_name","description":"Brief description with dimensions","componentChecklist":[{"item":"verification item","visibility":"visual","assemblyVisibility":"visible"}]}],"assemblyNotes":"Brief positioning instructions"}`;

  // Prefer constructionSpec for decomposition — it contains precise geometric
  // operations which map better to component boundaries than semantic descriptions
  let fullPrompt: string;
  if (constructionSpec) {
    fullPrompt = `User request: ${promptText}\n\nConstruction Specification:\n${constructionSpec}`;
  } else if (interpretation) {
    fullPrompt = `User request: ${promptText}\n\nInterpretation: ${interpretation}`;
  } else {
    fullPrompt = promptText;
  }

  const result = await trackedGenerateText({
    model,
    system: systemPrompt,
    prompt: fullPrompt,
    ...buildGenerateOptions(modelConfig),
    maxOutputTokens: maxOutputWithThinking(2048, modelConfig),
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
    const decomposed = parseDecompositionResponse(result.text);

    if (decomposed.components.length < 2) {
      throw new Error("Decomposition produced fewer than 2 components");
    }

    logger.info(
      { componentCount: decomposed.components.length, components: decomposed.components.map(c => c.name) },
      "prompt decomposed into components",
    );

    return {
      ...decomposed,
      promptTokens,
      completionTokens,
    };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), text: result.text.slice(0, 200) }, "decomposition parsing failed");
    throw new Error(`Failed to decompose prompt: ${err instanceof Error ? err.message : String(err)}`);
  }
}
