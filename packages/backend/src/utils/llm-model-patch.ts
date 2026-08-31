/**
 * Validates and normalises a PATCH body for an LLM model (issue #24).
 *
 * Two shapes reach this endpoint: the camelCase the service layer uses, and the
 * snake_case the GET endpoint returns — a client that reads a model, edits a
 * field and sends it back is using the latter. Both are accepted and normalised
 * to camelCase here.
 *
 * Everything else is rejected rather than dropped. The previous behaviour
 * discarded unrecognised keys with a bare `continue` and answered 200 with the
 * unchanged row, so a mistyped field name looked exactly like a successful
 * update — which is how a model price sat at 0 while the API reported success.
 */

type FieldCheck = (value: unknown) => boolean;

const isNumber: FieldCheck = v => typeof v === "number" && Number.isFinite(v);
const isString: FieldCheck = v => typeof v === "string";
const isBoolean: FieldCheck = v => typeof v === "boolean";
const nullable = (check: FieldCheck): FieldCheck => v => v === null || check(v);

interface FieldSpec {
  /** snake_case alias as returned by GET, when it differs from the camelCase name. */
  alias?: string;
  check: FieldCheck;
  expected: string;
}

const FIELDS: Record<string, FieldSpec> = {
  provider: { check: isString, expected: "a string" },
  modelName: { alias: "model_name", check: isString, expected: "a string" },
  displayName: { alias: "display_name", check: isString, expected: "a string" },
  costPer1mInput: { alias: "cost_per_1m_input", check: isNumber, expected: "a number" },
  costPer1mOutput: { alias: "cost_per_1m_output", check: isNumber, expected: "a number" },
  maxOutputTokens: { alias: "max_output_tokens", check: nullable(isNumber), expected: "a number or null" },
  maxContextTokens: { alias: "max_context_tokens", check: nullable(isNumber), expected: "a number or null" },
  supportsThinking: { alias: "supports_thinking", check: isBoolean, expected: "a boolean" },
  defaultThinkingEffort: { alias: "default_thinking_effort", check: nullable(isString), expected: "a string or null" },
  supportsVision: { alias: "supports_vision", check: isBoolean, expected: "a boolean" },
  supportsEmbeddings: { alias: "supports_embeddings", check: isBoolean, expected: "a boolean" },
  streamingEnabled: { alias: "streaming_enabled", check: isBoolean, expected: "a boolean" },
  vlmEvalPreamble: { alias: "vlm_eval_preamble", check: nullable(isString), expected: "a string or null" },
  tier: { check: nullable(isString), expected: "a string or null" },
  isActive: { alias: "is_active", check: isBoolean, expected: "a boolean" },
};

/** snake_case alias -> camelCase field name. */
const BY_ALIAS = new Map<string, string>(
  Object.entries(FIELDS)
    .filter(([, spec]) => spec.alias)
    .map(([name, spec]) => [spec.alias as string, name]),
);

export type LlmModelPatchResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

export function parseLlmModelPatch(patch: Record<string, unknown>): LlmModelPatchResult {
  const data: Record<string, unknown> = {};
  const unknown: string[] = [];

  for (const [key, value] of Object.entries(patch)) {
    const name = key in FIELDS ? key : BY_ALIAS.get(key);
    if (!name) {
      unknown.push(key);
      continue;
    }
    const spec = FIELDS[name];
    if (!spec.check(value)) {
      return { ok: false, error: `${key} must be ${spec.expected}` };
    }
    data[name] = value;
  }

  if (unknown.length > 0) {
    return { ok: false, error: `Unknown field(s): ${unknown.join(", ")}` };
  }
  if (Object.keys(data).length === 0) {
    return { ok: false, error: "No updatable fields in request body" };
  }
  return { ok: true, data };
}
