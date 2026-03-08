-- Agent Feed System
-- Enables emergent agent-to-agent interaction via internal feed posts

-- ============================================================
-- Agent Feed Posts Table
-- ============================================================
CREATE TABLE agent_feed_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  author VARCHAR(20) NOT NULL,
  post_type VARCHAR(20) NOT NULL CHECK (post_type IN (
    'observation', 'question', 'idea', 'build', 'challenge', 'pattern', 'prediction'
  )),
  content TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',

  -- Relationships
  related_opportunity_id VARCHAR(100),
  reply_to_post_id UUID REFERENCES agent_feed_posts(id),
  build_on_post_id UUID REFERENCES agent_feed_posts(id),

  -- Engagement metrics (auto-updated via triggers)
  upvotes INTEGER DEFAULT 0,
  builds INTEGER DEFAULT 0,
  challenges INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,

  -- Metadata
  importance INTEGER DEFAULT 5 CHECK (importance >= 1 AND importance <= 10),
  visibility VARCHAR(20) DEFAULT 'internal' CHECK (visibility IN ('internal', 'slack_eligible', 'posted_to_slack')),
  notion_page_id VARCHAR(100),
  slack_thread_ts VARCHAR(50),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Embedding for semantic search
  embedding VECTOR(1536)
);

-- Indexes
CREATE INDEX idx_feed_posts_author ON agent_feed_posts(author);
CREATE INDEX idx_feed_posts_type ON agent_feed_posts(post_type);
CREATE INDEX idx_feed_posts_created ON agent_feed_posts(created_at DESC);
CREATE INDEX idx_feed_posts_tags ON agent_feed_posts USING GIN(tags);
CREATE INDEX idx_feed_posts_importance ON agent_feed_posts(importance DESC);
CREATE INDEX idx_feed_posts_reply_to ON agent_feed_posts(reply_to_post_id) WHERE reply_to_post_id IS NOT NULL;
CREATE INDEX idx_feed_posts_build_on ON agent_feed_posts(build_on_post_id) WHERE build_on_post_id IS NOT NULL;

-- ============================================================
-- Agent Feed Reactions Table
-- ============================================================
CREATE TABLE agent_feed_reactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID NOT NULL REFERENCES agent_feed_posts(id) ON DELETE CASCADE,
  reactor VARCHAR(20) NOT NULL,
  reaction_type VARCHAR(20) NOT NULL CHECK (reaction_type IN (
    'upvote', 'build', 'challenge', 'important', 'curious'
  )),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent duplicate reactions of same type from same agent
  UNIQUE(post_id, reactor, reaction_type)
);

CREATE INDEX idx_feed_reactions_post ON agent_feed_reactions(post_id);
CREATE INDEX idx_feed_reactions_reactor ON agent_feed_reactions(reactor);

-- ============================================================
-- Trigger: Update engagement counters on reaction
-- ============================================================
CREATE OR REPLACE FUNCTION update_feed_post_engagement()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE agent_feed_posts SET
      upvotes = CASE WHEN NEW.reaction_type = 'upvote' THEN upvotes + 1 ELSE upvotes END,
      builds = CASE WHEN NEW.reaction_type = 'build' THEN builds + 1 ELSE builds END,
      challenges = CASE WHEN NEW.reaction_type = 'challenge' THEN challenges + 1 ELSE challenges END,
      updated_at = NOW()
    WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE agent_feed_posts SET
      upvotes = CASE WHEN OLD.reaction_type = 'upvote' THEN GREATEST(upvotes - 1, 0) ELSE upvotes END,
      builds = CASE WHEN OLD.reaction_type = 'build' THEN GREATEST(builds - 1, 0) ELSE builds END,
      challenges = CASE WHEN OLD.reaction_type = 'challenge' THEN GREATEST(challenges - 1, 0) ELSE challenges END,
      updated_at = NOW()
    WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_feed_post_engagement
AFTER INSERT OR DELETE ON agent_feed_reactions
FOR EACH ROW EXECUTE FUNCTION update_feed_post_engagement();

-- ============================================================
-- Trigger: Update reply count on new replies
-- ============================================================
CREATE OR REPLACE FUNCTION update_feed_post_reply_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.reply_to_post_id IS NOT NULL THEN
    UPDATE agent_feed_posts SET
      reply_count = reply_count + 1,
      updated_at = NOW()
    WHERE id = NEW.reply_to_post_id;
  ELSIF TG_OP = 'DELETE' AND OLD.reply_to_post_id IS NOT NULL THEN
    UPDATE agent_feed_posts SET
      reply_count = GREATEST(reply_count - 1, 0),
      updated_at = NOW()
    WHERE id = OLD.reply_to_post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_feed_post_reply_count
AFTER INSERT OR DELETE ON agent_feed_posts
FOR EACH ROW EXECUTE FUNCTION update_feed_post_reply_count();

-- ============================================================
-- Function: Semantic search for feed posts
-- ============================================================
CREATE OR REPLACE FUNCTION match_feed_posts(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  author VARCHAR(20),
  post_type VARCHAR(20),
  content TEXT,
  tags TEXT[],
  importance INTEGER,
  upvotes INTEGER,
  builds INTEGER,
  reply_count INTEGER,
  created_at TIMESTAMPTZ,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.author,
    p.post_type,
    p.content,
    p.tags,
    p.importance,
    p.upvotes,
    p.builds,
    p.reply_count,
    p.created_at,
    1 - (p.embedding <=> query_embedding) AS similarity
  FROM agent_feed_posts p
  WHERE p.embedding IS NOT NULL
    AND 1 - (p.embedding <=> query_embedding) > match_threshold
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ============================================================
-- RLS Policies
-- ============================================================
ALTER TABLE agent_feed_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_feed_reactions ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role has full access to feed posts"
  ON agent_feed_posts FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to feed reactions"
  ON agent_feed_reactions FOR ALL
  USING (auth.role() = 'service_role');
