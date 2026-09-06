/**
 * The qualified judges (issue #58, ADR 0004; issue #62).
 *
 * A judge may rate the corpus that the fine-tuning filter reads only once it
 * has cleared the qualification bar — complete, stable, and on adjudicated
 * disagreements no worse than the reference — and qualification is granted
 * per (Judge, Instrument id). This list is that grant, kept in code beside
 * the instrument and changed by reviewed diff, with the qualification run
 * and the adjudication sheet linked from each entry. Any instrument revision
 * revokes it: a new id matches no entry until the terms are re-run.
 *
 * Each judge is named exactly as production stamps it — `provider/model_name`
 * in `vlm_model` and the effective thinking effort in `vlm_thinking_effort`
 * — so a stored row can be matched to its grant without a lookup. A judge
 * that is not on this list under the current id produces Provisional
 * ratings: kept, gate-derived, excluded from the training export.
 */

export interface QualifiedJudge {
  /** `provider/model_name`, as stamped in `vlm_model`. */
  model: string;
  /** The effective thinking effort, as stamped in `vlm_thinking_effort`. */
  thinkingEffort: string;
  /** The Instrument id the judge qualified under; a revision revokes it. */
  instrumentId: string;
  /** The day the adjudication closed (ISO date). */
  qualifiedOn: string;
  /** The qualification run and the adjudication sheet, at least. */
  evidence: readonly string[];
}

export const QUALIFIED_JUDGES: readonly QualifiedJudge[] = [
  {
    // Qualified on the 125 (issue #57, 2026-09-06); provisional until the
    // first re-rating batch's spot check (issue #63). Model row 98d284fe
    // "qwen3.8-27b-nvfp4 (thinking off, 3-node pool)".
    model: "vllm-dgx-14/qwen3.8-27b-nvfp4",
    thinkingEffort: "off",
    instrumentId: "production@22e0f10b0505",
    qualifiedOn: "2026-09-06",
    evidence: [
      // The screen: completeness and stability PASS as the pool's sole tenant (runs 62b4fa58, 043c80fd).
      "https://github.com/kreuzhofer/chat3d-app/issues/61#issuecomment-5559823696",
      // The adjudication of the 69 disagreements against the reference (run 6f6bb5c0): false passes 5 vs 19, false fails 18 vs 16.
      "https://github.com/kreuzhofer/chat3d-app/issues/57#issuecomment-5560474019",
      "packages/backend/prototypes/57-adjudication/",
    ],
  },
];
