ALTER TABLE "workbench_examples"
  DROP CONSTRAINT "workbench_examples_render_error_category_check";

ALTER TABLE "workbench_examples"
  ADD CONSTRAINT "workbench_examples_render_error_category_check"
  CHECK (
    "render_error_category" IS NULL OR
    "render_error_category" IN (
      'infrastructure', 'api_misuse', 'geometry',
      'type_error', 'kernel_error', 'syntax', 'unknown',
      'prompt_validation'
    )
  );
