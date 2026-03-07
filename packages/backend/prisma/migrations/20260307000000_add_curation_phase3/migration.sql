-- Tags on workbench prompts
CREATE TABLE workbench_prompt_tags (
  prompt_id UUID NOT NULL REFERENCES workbench_example_prompts(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (prompt_id, tag_id)
);

-- Link curation candidate to created workbench example
ALTER TABLE curation_candidates ADD COLUMN workbench_example_id UUID REFERENCES workbench_examples(id);

-- "User Generated Models" workbench category
INSERT INTO workbench_categories (id, rank, name, complexity, description)
VALUES (
  gen_random_uuid(), 100, 'User Generated Models', 5,
  'Community-contributed models promoted from user chats via the curation pipeline.'
);
