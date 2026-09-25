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
  {
    // TRANSITIONAL (2026-09-25): fails ADR 0004's amended false-fail term
    // against Kimi K3 (24 vs 21 on the 125). Its existing ratings stay
    // admitted only until rc0 has re-rated the corpus (#96); remove this
    // entry when that batch completes.
    // Qualified under the three-view revision. On the 125: issue #83's screen
    // (identity, completeness, stability at 2.7% against the 2.9% floor) and
    // issue #85's adjudication of the 70 disagreements with the reference
    // (Daniel's verdicts: false passes 6 vs the reference's 18, false fails
    // 17 vs 20 against an allowance of 40, 9 N). Confirmed by the re-rating
    // batch's spot check (issue #87, 2026-09-09): on 125 sampled corpus rows
    // against the reference once, Daniel's verdicts on the 31 hard flips gave
    // false passes 3 vs 4 and false fails 10 vs 10 against an allowance of
    // 20, 4 N. No longer provisional; the next instrument revision revokes it.
    model: "vllm-dgx-14/qwen3.8-27b-nvfp4",
    thinkingEffort: "off",
    instrumentId: "production@4892d8d1b160",
    qualifiedOn: "2026-09-09",
    evidence: [
      "https://github.com/kreuzhofer/chat3d-app/issues/85",
      "https://github.com/kreuzhofer/chat3d-app/issues/83",
      "packages/backend/prototypes/85-adjudication/",
      "https://claude.ai/code/artifact/e265b10f-06a3-4e37-86eb-4778acff385c",
      "https://github.com/kreuzhofer/chat3d-app/issues/87",
      "packages/backend/prototypes/87-batch/",
      "https://claude.ai/code/artifact/77301d83-215d-4b90-9581-5250257318a4",
    ],
  },
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
