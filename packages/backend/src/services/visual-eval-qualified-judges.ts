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
    // rc0 — the first fine-tuned judge (issue #95: LoRA on Qwen3.8-27B from
    // Daniel's adjudicated gold, trained on Nebius, merged BF16 with the MTP
    // head, danielkreuzhofer/chat3d-judge-rc0@6cbd3011, served on spark-01).
    // Qualified 2026-09-25 against the token-factory reference Kimi K3
    // (thinking off; #112) under ADR 0004 as amended that day (false-fail
    // allowance max(2 × reference, 5 % of its passes)). On the 125: identity
    // and completeness clean, stability 511/511 identical; against Kimi,
    // false passes 5 vs 13, false fails 11 vs an allowance of 21 (the
    // incumbent: 5 vs 14 and 24 — fails). Corpus spot check (125 seed-96
    // corpus rows): false passes 1 vs 4, false fails 5 vs an allowance of 18.
    model: "vllm-dgx-14/chat3d-judge-rc0",
    thinkingEffort: "off",
    instrumentId: "production@4892d8d1b160",
    qualifiedOn: "2026-09-25",
    evidence: [
      "https://github.com/kreuzhofer/chat3d-app/issues/96",
      "https://github.com/kreuzhofer/chat3d-app/issues/95",
      "https://github.com/kreuzhofer/chat3d-app/issues/112",
      "packages/backend/prototypes/96-rc0/",
    ],
  },
  // qwen3.8-27b-nvfp4 (thinking off) under production@4892d8d1b160 was
  // qualified 2026-09-09 against Sonnet 4.6 (#85, #87) and RETIRED
  // 2026-09-26: against the new reference Kimi K3 it fails ADR 0004's
  // amended false-fail term (24 vs 21 on the 125, #96); its entry stayed
  // transitional until rc0 had re-rated all 2,505 of its ratings.
  //
  // No judge is qualified under production@22e0f10b0505 (superseded).
  //
  // qwen3.8-27b-nvfp4 (thinking off; model row 98d284fe, the pooled
  // served name) qualified on the 125 on 2026-09-06 (issue #57: false
  // passes 5 vs the reference's 19, false fails 18 vs 16) and was
  // REVOKED on 2026-09-07 by the first re-rating batch's spot check
  // (issue #63, ADR 0004): on 125 sampled corpus rows against the
  // reference once under the same id, Daniel's adjudication of the 25
  // hard flips gave batch false passes 2 vs 5 (holds) and batch false
  // fails 10 vs 4, allowance 8 (fails). Its ratings are Provisional
  // again — kept, gate-derived, outside the training export — until it
  // re-qualifies under the next instrument revision.
  //   https://github.com/kreuzhofer/chat3d-app/issues/63
  //   packages/backend/prototypes/63-spot-check/
];
