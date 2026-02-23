-- Agent Memory System
-- Enables agents to remember past experiences, form insights, and reference history

CREATE TABLE agent_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who and what
  agent TEXT NOT NULL,  -- 'maya', 'david', 'rosa', 'james', 'patricia', 'marcus'
  memory_type TEXT NOT NULL,  -- 'observation', 'reflection', 'insight', 'outcome', 'conversation'

  -- The memory itself
  content TEXT NOT NULL,  -- Natural language description

  -- Context (optional linkage)
  related_opportunity_id TEXT,  -- notice_id if related to specific opportunity
  related_event_id UUID,  -- link to agent_events if triggered by event

  -- Importance & retrieval
  importance INTEGER DEFAULT 5 CHECK (importance >= 1 AND importance <= 10),
  embedding VECTOR(1536),  -- For semantic search (future)

  -- Metadata
  tags TEXT[],  -- ['hhs', 'lost-bid', 'timeline-concern']

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ,  -- Track when memory was retrieved

  -- Expiry (optional - some memories fade)
  expires_at TIMESTAMPTZ
);

-- Indexes for efficient querying
CREATE INDEX idx_memories_agent ON agent_memories(agent, created_at DESC);
CREATE INDEX idx_memories_type ON agent_memories(memory_type);
CREATE INDEX idx_memories_opportunity ON agent_memories(related_opportunity_id);
CREATE INDEX idx_memories_importance ON agent_memories(importance DESC);
CREATE INDEX idx_memories_tags ON agent_memories USING GIN(tags);

-- Enable Row Level Security (service_role only)
ALTER TABLE agent_memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role has full access to agent_memories" ON agent_memories
  FOR ALL USING (auth.role() = 'service_role');
