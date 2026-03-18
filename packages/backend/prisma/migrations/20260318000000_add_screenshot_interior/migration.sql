-- Add screenshot_interior column for the steep interior view angle (30° azimuth, 70° elevation).
-- This view looks steeply down into open-top models, making interior features
-- (standoffs, bosses, ribs) visible over the walls.
ALTER TABLE "workbench_examples" ADD COLUMN "screenshot_interior" TEXT;
