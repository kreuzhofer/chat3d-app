-- Add full-text search support to build123d_knowledge for hybrid RAG retrieval.
-- Uses a trigger to maintain the tsvector column on every INSERT/UPDATE,
-- since to_tsvector('english', ...) is not immutable and cannot be used
-- in a GENERATED ALWAYS AS ... STORED column.

ALTER TABLE build123d_knowledge
  ADD COLUMN search_vector tsvector;

-- Create trigger function to auto-update search_vector
CREATE OR REPLACE FUNCTION build123d_knowledge_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', array_to_string(NEW.concepts, ' ')), 'A') ||
    setweight(to_tsvector('english', left(NEW.code, 2000)), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_b123d_knowledge_fts
  BEFORE INSERT OR UPDATE OF title, description, code, concepts
  ON build123d_knowledge
  FOR EACH ROW
  EXECUTE FUNCTION build123d_knowledge_search_vector_update();

-- Backfill existing rows
UPDATE build123d_knowledge SET search_vector =
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
  setweight(to_tsvector('english', array_to_string(concepts, ' ')), 'A') ||
  setweight(to_tsvector('english', left(code, 2000)), 'C');

CREATE INDEX idx_b123d_knowledge_fts ON build123d_knowledge USING gin (search_vector);
