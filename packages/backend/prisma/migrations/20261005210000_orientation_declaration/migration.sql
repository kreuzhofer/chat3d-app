-- The spec's Orientation declaration (issue #138, ADR 0007): what is up as the
-- object is used and which feature faces front (−Y), as {"up", "front"} with
-- front NULL for "no front". Codegen builds to it and the code reviewer checks
-- prompt-stated directions against it. NULL = a spec written before #138 (the
-- marking pass, #141, fills those).

ALTER TABLE workbench_example_prompts
  ADD COLUMN orientation_declaration JSONB;
