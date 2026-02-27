-- Match agent memories by semantic similarity
-- Used by the memory system for retrieving relevant past experiences

CREATE OR REPLACE FUNCTION match_agent_memories(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  agent TEXT,
  memory_type TEXT,
  content TEXT,
  related_opportunity_id TEXT,
  related_event_id UUID,
  importance INTEGER,
  embedding VECTOR(1536),
  tags TEXT[],
  created_at TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    am.id,
    am.agent,
    am.memory_type,
    am.content,
    am.related_opportunity_id,
    am.related_event_id,
    am.importance,
    am.embedding,
    am.tags,
    am.created_at,
    am.last_accessed_at,
    am.expires_at,
    1 - (am.embedding <=> query_embedding) AS similarity
  FROM agent_memories am
  WHERE am.embedding IS NOT NULL
    AND (am.expires_at IS NULL OR am.expires_at > NOW())
    AND (1 - (am.embedding <=> query_embedding)) > match_threshold
  ORDER BY am.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Create an index for faster vector similarity search
CREATE INDEX IF NOT EXISTS idx_memories_embedding ON agent_memories USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Grant execute permission
GRANT EXECUTE ON FUNCTION match_agent_memories(VECTOR(1536), FLOAT, INT) TO service_role;
