-- Remove unused screenshot_interior column (interior view angle reverted).
ALTER TABLE "workbench_examples" DROP COLUMN IF EXISTS "screenshot_interior";
