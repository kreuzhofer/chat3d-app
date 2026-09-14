/**
 * Visual Evaluation Response Schema — guided JSON for the judge
 *
 * Builds the JSON schema the judge's answer must satisfy and decides, per
 * provider, whether to enforce it at decode time.
 *
 * On OpenAI-compatible providers (vLLM) the schema travels as
 * `response_format: {type: "json_schema"}`; vLLM compiles it into a decoding
 * grammar, so a structurally invalid answer cannot occur: no code fences, no
 * missing keys, no invented score, exactly one checklist entry per question
 * asked. Anthropic — the reference judge — is deliberately left
 * unconstrained: its SDK would switch to the structured-outputs beta (or a
 * JSON tool) and the reference would no longer be the reference.
 *
 * The schema sticks to features every vLLM structured-output backend
 * accepts (enum, fixed-length arrays, required, additionalProperties). No
 * numeric ranges, no string formats, no uniqueItems.
 *
 * What guided decoding cannot fix: a reasoning model that spends the whole
 * output budget thinking. vLLM constrains only the text after the reasoning,
 * so an answer that never starts stays empty; visual-eval names that case.
 */
import { Output, jsonSchema, type JSONSchema7 } from "ai";
import { sdkType, type LlmModelConfig } from "./llm-config.service.js";

export interface EvaluationResponse {
  score: number;
  issues: string[];
  suggestions: string[];
  checklist?: Array<{ question: string; pass: boolean | null; detail: string }>;
  inventory?: PartsInventory;
}

/**
 * The answer shapes an instrument may ask for.
 *
 * `production` is score + issues + suggestions + checklist. `inventory`
 * prepends a parts inventory (issue #66): under guided decoding the schema's
 * key order is the generation order, so an inventory declared before the
 * checklist is written first and every item is answered with it already in
 * the judge's own context. That is the whole mechanism — the judge takes
 * stock of what is in the scene before it is asked whether a feature of it
 * is correct. `evidence-first` keeps production's keys but orders each
 * checklist item `question → detail → pass` (issue #60): under guided
 * decoding the judge then writes its evidence before it commits a verdict,
 * where production commits first and explains after.
 */
export const RESPONSE_SHAPES = ["production", "inventory", "evidence-first"] as const;
export type ResponseShape = (typeof RESPONSE_SHAPES)[number];

/** The one check every path that reads a stored shape uses (the create validation and the run executor). */
export function isResponseShape(value: unknown): value is ResponseShape {
  return typeof value === "string" && (RESPONSE_SHAPES as readonly string[]).includes(value);
}

/** The parts inventory an `inventory`-shaped instrument answers first (issue #66). */
export interface PartsInventory {
  bodyCount: number;
  bodies: string;
  partsNamed: string;
  openings: string;
}

/** The zoom follow-up's answer to one uncertain item (issue #56). */
export interface FollowUpResponse {
  pass: boolean;
  detail: string;
}

/** Names sent as `json_schema.name`; they show up in provider logs. */
export const EVALUATION_OUTPUT_NAME = "evaluation";
export const FOLLOW_UP_OUTPUT_NAME = "follow_up";

const SCORE_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * The inventory's own shape: a body count that can be checked against the
 * images without reading prose, and three sentences of evidence. No numeric
 * range on the count — the schema sticks to what every vLLM structured-output
 * backend accepts.
 */
const PARTS_INVENTORY_SCHEMA: JSONSchema7 = {
  type: "object",
  properties: {
    bodyCount: { type: "integer" },
    bodies: { type: "string" },
    partsNamed: { type: "string" },
    openings: { type: "string" },
  },
  required: ["bodyCount", "bodies", "partsNamed", "openings"],
  additionalProperties: false,
};

/**
 * The evaluation answer as a JSON schema. `checklistCount` is the number of
 * non-blank questions the judge was asked: the checklist array is pinned to
 * exactly that length so reconciliation is positional, never fuzzy. With no
 * question asked there is no checklist property at all.
 */
export function buildEvaluationResponseSchema(
  checklistCount: number,
  shape: ResponseShape = "production",
): JSONSchema7 {
  const properties: Record<string, JSONSchema7> = {};
  // Declared first on purpose: the grammar emits keys in this order, so the
  // inventory is written before any item is answered (issue #66).
  if (shape === "inventory") properties.inventory = PARTS_INVENTORY_SCHEMA;
  Object.assign(properties, {
    score: { type: "integer", enum: SCORE_VALUES },
    issues: { type: "array", items: { type: "string" } },
    suggestions: { type: "array", items: { type: "string" } },
  } satisfies Record<string, JSONSchema7>);
  const required = shape === "inventory"
    ? ["inventory", "score", "issues", "suggestions"]
    : ["score", "issues", "suggestions"];

  if (checklistCount > 0) {
    properties.checklist = {
      type: "array",
      minItems: checklistCount,
      maxItems: checklistCount,
      items: {
        type: "object",
        // Key order is generation order on vLLM: production commits `pass`
        // before writing `detail`; evidence-first writes `detail` first (#60).
        properties: shape === "evidence-first"
          ? { question: { type: "string" }, detail: { type: "string" }, pass: { enum: [true, false, null] } }
          : { question: { type: "string" }, pass: { enum: [true, false, null] }, detail: { type: "string" } },
        required: shape === "evidence-first" ? ["question", "detail", "pass"] : ["question", "pass", "detail"],
        additionalProperties: false,
      },
    };
    required.push("checklist");
  }

  return { type: "object", properties, required, additionalProperties: false };
}

/**
 * The zoom follow-up's answer as a JSON schema: a committed pass/fail and the
 * evidence. No `null` — the follow-up exists to resolve uncertainty, and the
 * prompt forbids answering uncertain.
 */
export function buildFollowUpResponseSchema(): JSONSchema7 {
  return {
    type: "object",
    properties: { pass: { type: "boolean" }, detail: { type: "string" } },
    required: ["pass", "detail"],
    additionalProperties: false,
  };
}

/**
 * Only the OpenAI-compatible SDK path (vLLM and friends) gets the schema on
 * the main evaluation call. Every other provider type — Anthropic above all —
 * keeps a free-text call there: the reference's first pass is measured under
 * that shape and is not moved by a follow-up fix.
 */
export function supportsGuidedJson(cfg: LlmModelConfig): boolean {
  return sdkType(cfg) === "openai-compatible";
}

/**
 * The zoom follow-up is constrained on Anthropic as well (issue #64): under
 * the follow-up template's evidence clause Sonnet answered in prose and hit
 * the output cap before any JSON on 11 of 53 follow-ups, leaving the items
 * uncertain. The SDK's Anthropic provider turns the shape into the API's
 * native structured output where the model supports it and into a JSON tool
 * otherwise; either way the reply is the object or a NoObjectGeneratedError.
 */
export function supportsFollowUpShape(cfg: LlmModelConfig): boolean {
  const type = sdkType(cfg);
  return type === "openai-compatible" || type === "anthropic";
}

/**
 * The `output` option for a judge call (the evaluation's streamText, the
 * follow-up's generateText), or undefined when the provider is not
 * constrained. The SDK turns it into `responseFormat: {type: "json", schema}`;
 * the openai-compatible provider is created with structured outputs enabled
 * (llm-config) so that becomes `response_format: json_schema` on the wire
 * rather than a bare json_object.
 */
export function resolveGuidedJsonOutput<T = EvaluationResponse>(
  cfg: LlmModelConfig,
  schema: JSONSchema7,
  name: string = EVALUATION_OUTPUT_NAME,
) {
  if (!supportsGuidedJson(cfg)) return undefined;
  return Output.object({ schema: jsonSchema<T>(schema), name });
}

/** The follow-up's `output` option: its `{pass, detail}` shape wherever the provider can hold a reply to it. */
export function resolveFollowUpOutput(cfg: LlmModelConfig) {
  if (!supportsFollowUpShape(cfg)) return undefined;
  return Output.object({ schema: jsonSchema<FollowUpResponse>(buildFollowUpResponseSchema()), name: FOLLOW_UP_OUTPUT_NAME });
}
