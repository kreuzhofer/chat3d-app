/**
 * Per-row minimal system prompt for training-data exports.
 *
 * The runtime tiered system prompt is sized for inference (it must hedge
 * against features the agent might use). For training, we have ground truth:
 * the final approved code. So the system prompt can collapse to:
 *   - a small always-on core (intro, output contract, primitives, boolean,
 *     positioning, build contexts)
 *   - conditional sections whose detection regex matches the final code
 *
 * Two modes:
 *   "code-only"  — alpaca-codegen + sharegpt-codegen (single-turn formats
 *                  that structurally cannot teach tool use)
 *   "trajectory" — agent_codegen rows where a thin workflow scaffold helps
 *                  anchor the multi-turn conversation; the trajectory itself
 *                  demonstrates the actual tool-use loop, so render-recovery
 *                  prose and pitfall narration are dropped
 */

import {
  detectCodeFeatures,
  CONDITIONAL_SECTIONS,
  CODEGEN_ALL_SECTIONS,
  CODEGEN_SECTION_INTRO,
  CODEGEN_SECTION_OUTPUT_CONTRACT,
  CODEGEN_SECTION_BUILD_CONTEXTS,
  CODEGEN_SECTION_3D_PRIMITIVES,
  CODEGEN_SECTION_BOOLEAN,
  CODEGEN_SECTION_POSITIONING,
} from "../../prompts/system-prompts.js";

export type MinimalPromptMode = "code-only" | "trajectory";

const TRAJECTORY_WORKFLOW = `## Workflow

You operate in a tool-use loop. Each turn must call at least one tool.
Loop: edit code → validate_code → render_project → submit_result.
Validate after every edit; submit only after render succeeds.`;

const CORE_ALWAYS_ON: string[] = [
  CODEGEN_SECTION_INTRO,
  CODEGEN_SECTION_OUTPUT_CONTRACT,
  CODEGEN_SECTION_BUILD_CONTEXTS,
  CODEGEN_SECTION_3D_PRIMITIVES,
  CODEGEN_SECTION_BOOLEAN,
  CODEGEN_SECTION_POSITIONING,
];

const CORE_SET = new Set<string>(CORE_ALWAYS_ON);

export function buildMinimalSystemPrompt(code: string, mode: MinimalPromptMode): string {
  const features = detectCodeFeatures(code);

  const included = new Set<string>(CORE_SET);
  for (const cs of CONDITIONAL_SECTIONS) {
    if (features.has(cs.key)) included.add(cs.section);
  }

  // Emit sections in canonical CODEGEN_ALL_SECTIONS order so successive rows
  // are byte-similar where the feature set overlaps (cache-friendly + readable).
  const apiReference = CODEGEN_ALL_SECTIONS.filter(s => included.has(s)).join("\n\n");

  if (mode === "trajectory") {
    return `${TRAJECTORY_WORKFLOW}\n\n${apiReference}`;
  }
  return apiReference;
}
