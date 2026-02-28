import type { Migration } from "./types.js";

export const migration015NewScreenshotAngles: Migration = {
  id: "015_new_screenshot_angles",
  up: [
    `ALTER TABLE workbench_examples ADD COLUMN IF NOT EXISTS screenshot_back TEXT;`,
    `ALTER TABLE workbench_examples ADD COLUMN IF NOT EXISTS screenshot_left TEXT;`,
    `ALTER TABLE workbench_examples ADD COLUMN IF NOT EXISTS screenshot_right TEXT;`,
    `ALTER TABLE workbench_examples ADD COLUMN IF NOT EXISTS screenshot_ortho_45 TEXT;`,
  ],
  down: [
    `ALTER TABLE workbench_examples DROP COLUMN IF EXISTS screenshot_back;`,
    `ALTER TABLE workbench_examples DROP COLUMN IF EXISTS screenshot_left;`,
    `ALTER TABLE workbench_examples DROP COLUMN IF EXISTS screenshot_right;`,
    `ALTER TABLE workbench_examples DROP COLUMN IF EXISTS screenshot_ortho_45;`,
  ],
};
