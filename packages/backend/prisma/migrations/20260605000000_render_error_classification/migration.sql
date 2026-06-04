ALTER TABLE "workbench_examples"
  ADD COLUMN "render_error_category" TEXT NULL,
  ADD COLUMN "render_error_detail" TEXT NULL;

ALTER TABLE "workbench_examples"
  ADD CONSTRAINT "workbench_examples_render_error_category_check"
  CHECK (
    "render_error_category" IS NULL OR
    "render_error_category" IN (
      'infrastructure', 'api_misuse', 'geometry',
      'type_error', 'kernel_error', 'syntax', 'unknown'
    )
  );

CREATE INDEX "idx_workbench_examples_render_error_category"
  ON "workbench_examples" ("render_error_category")
  WHERE "render_error_category" IS NOT NULL;

COMMENT ON COLUMN "workbench_examples"."render_error_category" IS
  'Classified render-error category from utils/render-errors.ts. Null on successful renders.';
COMMENT ON COLUMN "workbench_examples"."render_error_detail" IS
  'Regex-captured detail from the error message (e.g., the undefined name for NameError). Null when no capture group matched.';
