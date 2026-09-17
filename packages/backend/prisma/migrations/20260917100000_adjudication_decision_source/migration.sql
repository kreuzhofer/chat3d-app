-- Who decided an adjudication item (issue #111): a person, or the one-sided
-- rule #108 decided — a third judge's incumbent-was-right reading is a
-- training label without review. Kept apart so the bar's terms count only
-- human decisions and the export names the source.

ALTER TABLE adjudications ADD COLUMN decision_source VARCHAR(16);
UPDATE adjudications SET decision_source = 'human' WHERE decision IS NOT NULL;
