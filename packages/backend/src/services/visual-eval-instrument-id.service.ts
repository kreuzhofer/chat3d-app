/**
 * Instrument id and judge identity (issue #36, ADR 0003; issue #58, ADR 0004).
 *
 * Every stored evaluation carries the id of the instrument it was answered
 * under: a name plus a content hash of the WHOLE judging procedure — the
 * template, the response schema, the zoom follow-up's template and schema,
 * the views the follow-up enlarges, and the zoom settings. Two evaluations
 * are comparable only under the same
 * id; one whose id is not the current one is Stale. A hash cannot be
 * forgotten the way a version constant can, and an admin edit to a zoom
 * setting is a new revision because the follow-up is part of the procedure.
 *
 * The specimen is not hashed: the response schema is sized to the checklist
 * asked, so it is hashed at a sentinel size; the follow-up template is hashed
 * unrendered.
 *
 * A judge is qualified per (judge, instrument id), where the judge is the
 * model row with its thinking setting (ADR 0004). `vlm_model` stores only
 * `provider/model_name`, so the effective thinking effort is stamped beside
 * the id to tell two rows of one model apart.
 */
import { createHash } from "node:crypto";
import type { LlmModelConfig } from "./llm-config.service.js";
import { THINKING_EFFORTS, isThinkingEffort } from "../utils/thinking-effort.js";
import { getZoomSettings, type ZoomSettings } from "./generation-settings.service.js";
import { FOLLOW_UP_VIEWS } from "./visual-eval-views.js";
import {
  PRODUCTION_INSTRUMENT_TEMPLATE,
  FOLLOW_UP_INSTRUMENT_TEMPLATE,
} from "./visual-eval-instrument-templates.js";
import {
  buildEvaluationResponseSchema,
  buildFollowUpResponseSchema,
  type ResponseShape,
} from "./visual-eval-schema.service.js";

export type { ZoomSettings } from "./generation-settings.service.js";

/** The name production's instrument is stamped under; an experiment's is its variant id. */
export const PRODUCTION_INSTRUMENT_NAME = "production";

export interface JudgeInstrument {
  /** The name half of the id: `production`, or an experiment variant's id. */
  name: string;
  template: string;
  /**
   * The answer shape this instrument asks for; production's when omitted.
   * Part of the procedure, so it is hashed: two variants that differ only in
   * the shape of the answer are two instruments (issue #66).
   */
  responseShape?: ResponseShape;
}

export const PRODUCTION_INSTRUMENT: JudgeInstrument = {
  name: PRODUCTION_INSTRUMENT_NAME,
  template: PRODUCTION_INSTRUMENT_TEMPLATE,
};

const HASH_LENGTH = 12;
/** The response schema's checklist is sized per example; the hash sees one shape. */
const SCHEMA_SENTINEL_CHECKLIST_COUNT = 1;

/** `<name>@<hash12>` over the whole procedure. Pure: same inputs, same id. */
export function computeInstrumentId(instrument: JudgeInstrument, zoom: ZoomSettings): string {
  const procedure = {
    template: instrument.template,
    evaluationSchema: buildEvaluationResponseSchema(
      SCHEMA_SENTINEL_CHECKLIST_COUNT,
      instrument.responseShape ?? "production",
    ),
    followUpTemplate: FOLLOW_UP_INSTRUMENT_TEMPLATE,
    followUpSchema: buildFollowUpResponseSchema(),
    // Which views the follow-up is shown is part of the procedure, not a
    // setting beside it (issue #67): two runs that enlarge different views
    // are not the same instrument, and a hash cannot be forgotten.
    followUpViews: [...FOLLOW_UP_VIEWS],
    zoom: { enabled: zoom.enabled, resolutionPx: zoom.resolutionPx, maxFollowUps: zoom.maxFollowUps },
  };
  const hash = createHash("sha256").update(JSON.stringify(procedure)).digest("hex").slice(0, HASH_LENGTH);
  return `${instrument.name}@${hash}`;
}

/** The id production's judge stamps right now: its template under the live zoom settings. */
export async function currentInstrumentId(): Promise<string> {
  return computeInstrumentId(PRODUCTION_INSTRUMENT, await getZoomSettings());
}

/**
 * The judge's effective thinking setting, stamped beside the instrument id.
 * A model without thinking support never reasons ("off"); one with support
 * and no configured effort runs on its server template's default, which is
 * unknown here (null).
 */
export function judgeThinkingEffort(cfg: Pick<LlmModelConfig, "supportsThinking" | "thinkingEffort">): string | null {
  if (!cfg.supportsThinking) return "off";
  return cfg.thinkingEffort ?? null;
}

/**
 * The config a judge is actually run with (issue #99): thinking **off** unless
 * the caller explicitly asks for another effort. A judge is qualified per
 * (model, thinking setting, instrument) under ADR 0004, so the model row's
 * `default_thinking_effort` must never decide what an evaluation measures —
 * it is a hand-maintained convention, and a purpose override is editable. A
 * model without thinking support is returned as is; asking it for an effort
 * other than off is refused rather than silently ignored.
 */
export function withJudgeThinking<C extends Pick<LlmModelConfig, "supportsThinking" | "thinkingEffort">>(
  cfg: C,
  requested: string | null | undefined,
): C {
  if (requested != null && !isThinkingEffort(requested)) {
    throw new Error(`Judge thinking effort ${JSON.stringify(requested)} is not one of ${THINKING_EFFORTS.join(", ")}`);
  }
  if (!cfg.supportsThinking) {
    if (requested != null && requested !== "off") {
      throw new Error(`Judge thinking effort "${requested}" was asked for, but the model does not support thinking`);
    }
    return cfg;
  }
  return { ...cfg, thinkingEffort: requested ?? "off" };
}
