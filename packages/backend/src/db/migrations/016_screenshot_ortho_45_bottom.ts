import type { Migration } from "./types.js";

export const migration016ScreenshotOrtho45Bottom: Migration = {
  id: "016_screenshot_ortho_45_bottom",
  up: [
    `ALTER TABLE workbench_examples ADD COLUMN IF NOT EXISTS screenshot_ortho_45_bottom TEXT;`,
  ],
  down: [
    `ALTER TABLE workbench_examples DROP COLUMN IF EXISTS screenshot_ortho_45_bottom;`,
  ],
};
