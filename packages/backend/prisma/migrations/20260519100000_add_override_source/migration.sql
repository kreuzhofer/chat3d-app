-- Sticky empirical override for the decomposition decider cache.
-- NULL = normal LLM verdict; 'timeout_observed' = harness wrote this after a
-- single-agent pipeline timeout with stepCount=0 (clear over-reasoning hang).
-- Override rows survive DECIDER_VERSION bumps via the sentinel decider_version
-- 'observed-failure'.
ALTER TABLE "decomposition_decisions"
  ADD COLUMN "override_source" VARCHAR(32);

COMMENT ON COLUMN "decomposition_decisions"."override_source" IS
  'NULL = normal LLM decider verdict. timeout_observed = sticky decision set by the harness after a single-agent timeout-abort with stepCount=0.';

CREATE INDEX "idx_decomp_decisions_override_source"
  ON "decomposition_decisions"("override_source")
  WHERE "override_source" IS NOT NULL;
