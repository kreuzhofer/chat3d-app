import type { Migration } from "./types.js";

export const migration013ScreenshotIsoBack: Migration = {
  id: "013_screenshot_iso_back",
  up: [
    `ALTER TABLE workbench_examples ADD COLUMN IF NOT EXISTS screenshot_iso_back TEXT;`,
  ],
  down: [
    `ALTER TABLE workbench_examples DROP COLUMN IF EXISTS screenshot_iso_back;`,
  ],
};
