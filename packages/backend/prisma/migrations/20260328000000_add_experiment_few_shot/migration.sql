-- Add few-shot counts as an experiment variable (Cartesian product with models)
ALTER TABLE "experiment_experiments" ADD COLUMN "few_shot_counts" integer[];
ALTER TABLE "experiment_runs" ADD COLUMN "few_shot_count" integer;
