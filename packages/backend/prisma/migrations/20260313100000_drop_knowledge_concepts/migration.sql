-- Remove the concepts column from build123d_knowledge.
-- Concept-based tag search has been replaced by hybrid RAG (semantic + FTS).

-- Update the FTS trigger to remove the concepts field
CREATE OR REPLACE FUNCTION build123d_knowledge_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', left(NEW.code, 2000)), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Update the trigger to fire on the remaining columns only
DROP TRIGGER IF EXISTS trg_b123d_knowledge_fts ON build123d_knowledge;
CREATE TRIGGER trg_b123d_knowledge_fts
  BEFORE INSERT OR UPDATE OF title, description, code
  ON build123d_knowledge
  FOR EACH ROW
  EXECUTE FUNCTION build123d_knowledge_search_vector_update();

-- Drop the GIN index on concepts
DROP INDEX IF EXISTS idx_b123d_knowledge_concepts;

-- Drop the column
ALTER TABLE build123d_knowledge DROP COLUMN concepts;

-- Rebuild search vectors without the concepts field
UPDATE build123d_knowledge SET search_vector =
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
  setweight(to_tsvector('english', left(code, 2000)), 'C');
