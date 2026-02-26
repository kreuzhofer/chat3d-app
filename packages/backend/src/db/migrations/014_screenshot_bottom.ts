import type { Migration } from "./types.js";

export const migration014ScreenshotBottom: Migration = {
  id: "014_screenshot_bottom",
  up: [
    `ALTER TABLE workbench_examples ADD COLUMN IF NOT EXISTS screenshot_bottom TEXT;`,
  ],
  down: [
    `ALTER TABLE workbench_examples DROP COLUMN IF EXISTS screenshot_bottom;`,
  ],
};
