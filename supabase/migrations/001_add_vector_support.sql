-- Migration: Add vector support for semantic search
-- This migration adds embedding columns to existing tables and creates semantic cache

-- Enable pgvector extension (may already be enabled in Supabase)
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- ADD EMBEDDING COLUMNS TO EXISTING TABLES
-- ============================================

-- Add embedding to user_context for semantic preference matching
ALTER TABLE user_context ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Add embedding to conversation_memory for semantic recall
ALTER TABLE conversation_memory ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Add embedding to decision_patterns for semantic pattern matching
ALTER TABLE decision_patterns ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- ============================================
-- CREATE INDEXES FOR FAST SIMILARITY SEARCH
-- ============================================

-- IVFFlat indexes for approximate nearest neighbor search
-- lists = 100 is good for tables with 10k-100k rows

-- Index for user_context embeddings
CREATE INDEX IF NOT EXISTS idx_user_context_embedding
ON user_context USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Index for conversation_memory embeddings
CREATE INDEX IF NOT EXISTS idx_conversation_memory_embedding
ON conversation_memory USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Index for decision_patterns embeddings
CREATE INDEX IF NOT EXISTS idx_decision_patterns_embedding
ON decision_patterns USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- ============================================
-- SEMANTIC CACHE TABLE
-- ============================================

-- Cache for semantic query results (reduces API costs significantly)
CREATE TABLE IF NOT EXISTS semantic_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_text TEXT NOT NULL,
  query_embedding vector(1536),
  result JSONB NOT NULL,
  cache_type TEXT NOT NULL, -- 'research', 'response', 'analysis'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  hit_count INTEGER DEFAULT 0,
  last_hit_at TIMESTAMPTZ
);

-- Index for semantic similarity search on cache
CREATE INDEX IF NOT EXISTS idx_semantic_cache_embedding
ON semantic_cache USING ivfflat (query_embedding vector_cosine_ops)
WITH (lists = 100);

-- Index for cache expiry cleanup
CREATE INDEX IF NOT EXISTS idx_semantic_cache_expires
ON semantic_cache(expires_at);

-- Index for cache type filtering
CREATE INDEX IF NOT EXISTS idx_semantic_cache_type
ON semantic_cache(cache_type);

-- RLS for semantic_cache
ALTER TABLE semantic_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to semantic_cache" ON semantic_cache
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- AGENT THREAD PARTICIPATION TABLE
-- ============================================

-- Track which agents have participated in which threads (persists across restarts)
CREATE TABLE IF NOT EXISTS agent_thread_participation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent TEXT NOT NULL,
  thread_ts TEXT NOT NULL,
  channel_id TEXT,
  first_response_at TIMESTAMPTZ DEFAULT NOW(),
  last_response_at TIMESTAMPTZ DEFAULT NOW(),
  response_count INTEGER DEFAULT 1,
  UNIQUE(agent, thread_ts)
);

-- Indexes for thread participation
CREATE INDEX IF NOT EXISTS idx_agent_thread_agent
ON agent_thread_participation(agent, last_response_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_thread_ts
ON agent_thread_participation(thread_ts);

-- RLS for agent_thread_participation
ALTER TABLE agent_thread_participation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to agent_thread_participation" ON agent_thread_participation
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- AGENT HANDOFFS TABLE
-- ============================================

-- Structured handoffs between agents with context transfer
CREATE TABLE IF NOT EXISTS agent_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  thread_ts TEXT NOT NULL,
  context_summary TEXT NOT NULL,
  user_intent TEXT,
  relevant_facts TEXT[],
  open_questions TEXT[],
  recommended_action TEXT,
  acknowledged BOOLEAN DEFAULT FALSE,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for handoffs
CREATE INDEX IF NOT EXISTS idx_agent_handoffs_to
ON agent_handoffs(to_agent, acknowledged, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_handoffs_thread
ON agent_handoffs(thread_ts);

-- RLS for agent_handoffs
ALTER TABLE agent_handoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to agent_handoffs" ON agent_handoffs
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- FEEDBACK TRACKING TABLE
-- ============================================

-- Track reactions and feedback on agent responses
CREATE TABLE IF NOT EXISTS agent_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent TEXT NOT NULL,
  message_ts TEXT NOT NULL,
  thread_ts TEXT,
  feedback_type TEXT NOT NULL, -- 'reaction_positive', 'reaction_negative', 'rephrased_question', 'follow_up'
  reaction_emoji TEXT, -- if feedback_type is reaction
  original_response TEXT,
  user_follow_up TEXT, -- if feedback_type is rephrased_question
  similarity_score FLOAT, -- similarity between original question and follow-up
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_ts, feedback_type, reaction_emoji)
);

-- Indexes for feedback
CREATE INDEX IF NOT EXISTS idx_agent_feedback_agent
ON agent_feedback(agent, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_feedback_type
ON agent_feedback(feedback_type);

-- RLS for agent_feedback
ALTER TABLE agent_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to agent_feedback" ON agent_feedback
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- THREAD SUMMARIES TABLE
-- ============================================

-- Cache thread summaries for hierarchical context
CREATE TABLE IF NOT EXISTS thread_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_ts TEXT NOT NULL UNIQUE,
  channel_id TEXT,
  summary TEXT NOT NULL,
  message_count INTEGER NOT NULL,
  summarized_up_to_ts TEXT, -- last message timestamp included in summary
  participants TEXT[],
  key_topics TEXT[],
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for thread summaries
CREATE INDEX IF NOT EXISTS idx_thread_summaries_ts
ON thread_summaries(thread_ts);

CREATE INDEX IF NOT EXISTS idx_thread_summaries_embedding
ON thread_summaries USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- RLS for thread_summaries
ALTER TABLE thread_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to thread_summaries" ON thread_summaries
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- EXTRACTED FACTS TABLE
-- ============================================

-- Facts extracted from conversations by agents
CREATE TABLE IF NOT EXISTS extracted_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_type TEXT NOT NULL, -- 'preference', 'decision', 'context', 'pattern'
  subject TEXT, -- who/what this fact is about ('lapedra', 'tamara', 'company', etc.)
  content TEXT NOT NULL,
  source_thread_ts TEXT,
  source_message_ts TEXT,
  extracted_by TEXT NOT NULL, -- which agent extracted this
  confidence FLOAT DEFAULT 0.8, -- how confident we are this is accurate
  embedding vector(1536),
  verified BOOLEAN DEFAULT FALSE, -- if a human confirmed this
  still_relevant BOOLEAN DEFAULT TRUE,
  expires_at TIMESTAMPTZ, -- optional expiry
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for extracted facts
CREATE INDEX IF NOT EXISTS idx_extracted_facts_type
ON extracted_facts(fact_type, still_relevant);

CREATE INDEX IF NOT EXISTS idx_extracted_facts_subject
ON extracted_facts(subject, still_relevant);

CREATE INDEX IF NOT EXISTS idx_extracted_facts_embedding
ON extracted_facts USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- RLS for extracted_facts
ALTER TABLE extracted_facts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to extracted_facts" ON extracted_facts
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- HELPER FUNCTIONS FOR VECTOR SEARCH
-- ============================================

-- Function to search by embedding similarity
CREATE OR REPLACE FUNCTION search_by_embedding(
  table_name TEXT,
  query_embedding vector(1536),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY EXECUTE format(
    'SELECT id, 1 - (embedding <=> $1) as similarity
     FROM %I
     WHERE embedding IS NOT NULL
     AND 1 - (embedding <=> $1) > $2
     ORDER BY embedding <=> $1
     LIMIT $3',
    table_name
  ) USING query_embedding, match_threshold, match_count;
END;
$$;
