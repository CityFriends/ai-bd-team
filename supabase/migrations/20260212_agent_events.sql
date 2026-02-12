-- Agent Events System
-- Event-driven coordination layer for agent-to-agent communication
-- This is ADDITIVE - existing cron jobs and workflows continue working

-- ============================================================
-- Table: agent_events
-- The event bus scratchpad - agents publish and claim events
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Event identification
  event_type TEXT NOT NULL,

  -- Source and target
  source_agent TEXT NOT NULL,  -- 'maya', 'david', 'rosa', 'james', 'patricia', 'marcus', 'system'
  target_agent TEXT,  -- NULL means broadcast, specific agent name for directed events

  -- Event payload (JSON schema validated by TypeScript)
  payload JSONB NOT NULL DEFAULT '{}',

  -- Event chaining - track cause-and-effect relationships
  parent_event_id UUID REFERENCES agent_events(id),
  root_event_id UUID REFERENCES agent_events(id),
  chain_depth INTEGER NOT NULL DEFAULT 0,

  -- Processing status
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'claimed', 'processing', 'completed', 'failed', 'expired'

  -- Priority (1 = highest, 10 = lowest)
  priority INTEGER NOT NULL DEFAULT 5 CHECK (priority >= 1 AND priority <= 10),

  -- Slack context for thread continuity
  channel_id TEXT,
  thread_ts TEXT,

  -- Timing
  process_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- For delayed events
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),

  -- Retry handling
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,

  -- Claiming
  claimed_by TEXT,  -- Agent that claimed this event
  claimed_at TIMESTAMPTZ,

  -- Results
  result JSONB,  -- Result payload when completed

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Index for pending events (most common query)
CREATE INDEX IF NOT EXISTS idx_agent_events_pending
  ON agent_events(status, priority, process_after)
  WHERE status = 'pending';

-- Index for claiming events by target agent
CREATE INDEX IF NOT EXISTS idx_agent_events_target
  ON agent_events(target_agent, status, priority)
  WHERE status = 'pending';

-- Index for event chains
CREATE INDEX IF NOT EXISTS idx_agent_events_chain
  ON agent_events(root_event_id, chain_depth);

-- Index for cleanup
CREATE INDEX IF NOT EXISTS idx_agent_events_expires
  ON agent_events(expires_at)
  WHERE status IN ('pending', 'claimed');

-- Index for Slack thread lookups
CREATE INDEX IF NOT EXISTS idx_agent_events_thread
  ON agent_events(thread_ts, channel_id)
  WHERE thread_ts IS NOT NULL;

-- ============================================================
-- Table: agent_subscriptions
-- Define which agents listen to which event types
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Subscriber
  agent TEXT NOT NULL,

  -- What they subscribe to
  event_type TEXT NOT NULL,

  -- Optional priority override (NULL = use event priority)
  priority_override INTEGER CHECK (priority_override IS NULL OR (priority_override >= 1 AND priority_override <= 10)),

  -- Filter conditions (JSONB for flexibility)
  -- e.g., {"min_score": 70, "agency": ["VA", "HHS"]}
  filter_conditions JSONB DEFAULT '{}',

  -- Whether subscription is active
  enabled BOOLEAN NOT NULL DEFAULT TRUE,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unique constraint
  UNIQUE(agent, event_type)
);

-- Index for finding subscribers
CREATE INDEX IF NOT EXISTS idx_agent_subscriptions_lookup
  ON agent_subscriptions(event_type, enabled)
  WHERE enabled = TRUE;

-- ============================================================
-- Table: agent_event_metrics
-- Hourly aggregations for performance tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_event_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Time bucket (hourly)
  hour TIMESTAMPTZ NOT NULL,

  -- Agent (NULL for system-wide)
  agent TEXT,

  -- Event type (NULL for all types)
  event_type TEXT,

  -- Counts
  events_published INTEGER NOT NULL DEFAULT 0,
  events_processed INTEGER NOT NULL DEFAULT 0,
  events_failed INTEGER NOT NULL DEFAULT 0,
  events_expired INTEGER NOT NULL DEFAULT 0,

  -- Timing stats (in milliseconds)
  avg_processing_time_ms INTEGER,
  max_processing_time_ms INTEGER,

  -- Unique constraint
  UNIQUE(hour, agent, event_type)
);

-- Index for metrics queries
CREATE INDEX IF NOT EXISTS idx_agent_event_metrics_hour
  ON agent_event_metrics(hour DESC);

-- ============================================================
-- Function: publish_event()
-- Atomic event creation with chain tracking
-- ============================================================
CREATE OR REPLACE FUNCTION publish_event(
  p_event_type TEXT,
  p_source_agent TEXT,
  p_payload JSONB,
  p_target_agent TEXT DEFAULT NULL,
  p_parent_event_id UUID DEFAULT NULL,
  p_priority INTEGER DEFAULT 5,
  p_channel_id TEXT DEFAULT NULL,
  p_thread_ts TEXT DEFAULT NULL,
  p_process_after TIMESTAMPTZ DEFAULT NOW(),
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_root_event_id UUID;
  v_chain_depth INTEGER;
  v_event_id UUID;
  v_default_expires TIMESTAMPTZ;
BEGIN
  -- Calculate chain depth and root event
  IF p_parent_event_id IS NOT NULL THEN
    SELECT root_event_id, chain_depth + 1
    INTO v_root_event_id, v_chain_depth
    FROM agent_events
    WHERE id = p_parent_event_id;

    -- If parent doesn't have a root, it IS the root
    IF v_root_event_id IS NULL THEN
      v_root_event_id := p_parent_event_id;
    END IF;
  ELSE
    v_chain_depth := 0;
    v_root_event_id := NULL;
  END IF;

  -- Default expiry based on priority
  IF p_expires_at IS NULL THEN
    CASE
      WHEN p_priority <= 2 THEN v_default_expires := NOW() + INTERVAL '1 hour';
      WHEN p_priority <= 5 THEN v_default_expires := NOW() + INTERVAL '24 hours';
      ELSE v_default_expires := NOW() + INTERVAL '72 hours';
    END CASE;
  ELSE
    v_default_expires := p_expires_at;
  END IF;

  -- Insert the event
  INSERT INTO agent_events (
    event_type,
    source_agent,
    target_agent,
    payload,
    parent_event_id,
    root_event_id,
    chain_depth,
    priority,
    channel_id,
    thread_ts,
    process_after,
    expires_at
  ) VALUES (
    p_event_type,
    p_source_agent,
    p_target_agent,
    p_payload,
    p_parent_event_id,
    COALESCE(v_root_event_id, gen_random_uuid()),  -- Self-reference if no parent
    v_chain_depth,
    p_priority,
    p_channel_id,
    p_thread_ts,
    p_process_after,
    v_default_expires
  )
  RETURNING id INTO v_event_id;

  -- Update root_event_id to self if this is root
  IF p_parent_event_id IS NULL THEN
    UPDATE agent_events
    SET root_event_id = v_event_id
    WHERE id = v_event_id;
  END IF;

  RETURN v_event_id;
END;
$$;

-- ============================================================
-- Function: claim_events()
-- Atomic claim with FOR UPDATE SKIP LOCKED
-- Returns events for a specific agent to process
-- ============================================================
CREATE OR REPLACE FUNCTION claim_events(
  p_agent TEXT,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  event_type TEXT,
  source_agent TEXT,
  payload JSONB,
  parent_event_id UUID,
  root_event_id UUID,
  chain_depth INTEGER,
  priority INTEGER,
  channel_id TEXT,
  thread_ts TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT e.id
    FROM agent_events e
    WHERE e.status = 'pending'
      AND e.process_after <= NOW()
      AND e.expires_at > NOW()
      AND (
        -- Targeted at this agent
        e.target_agent = p_agent
        OR (
          -- Broadcast event that agent subscribes to
          e.target_agent IS NULL
          AND EXISTS (
            SELECT 1 FROM agent_subscriptions s
            WHERE s.agent = p_agent
              AND s.event_type = e.event_type
              AND s.enabled = TRUE
          )
        )
      )
    ORDER BY e.priority ASC, e.created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE agent_events ae
  SET
    status = 'claimed',
    claimed_by = p_agent,
    claimed_at = NOW(),
    updated_at = NOW()
  FROM claimable c
  WHERE ae.id = c.id
  RETURNING
    ae.id,
    ae.event_type,
    ae.source_agent,
    ae.payload,
    ae.parent_event_id,
    ae.root_event_id,
    ae.chain_depth,
    ae.priority,
    ae.channel_id,
    ae.thread_ts,
    ae.created_at;
END;
$$;

-- ============================================================
-- Function: complete_event()
-- Mark event as completed or failed
-- ============================================================
CREATE OR REPLACE FUNCTION complete_event(
  p_event_id UUID,
  p_success BOOLEAN,
  p_result JSONB DEFAULT NULL,
  p_error TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_retry_count INTEGER;
  v_max_retries INTEGER;
BEGIN
  IF p_success THEN
    -- Success - mark completed
    UPDATE agent_events
    SET
      status = 'completed',
      result = p_result,
      completed_at = NOW(),
      updated_at = NOW()
    WHERE id = p_event_id
      AND status IN ('claimed', 'processing');
  ELSE
    -- Failure - check if we should retry
    SELECT retry_count, max_retries INTO v_retry_count, v_max_retries
    FROM agent_events
    WHERE id = p_event_id;

    IF v_retry_count < v_max_retries THEN
      -- Retry with exponential backoff
      UPDATE agent_events
      SET
        status = 'pending',
        retry_count = retry_count + 1,
        last_error = p_error,
        process_after = NOW() + (INTERVAL '1 minute' * POWER(2, retry_count)),
        claimed_by = NULL,
        claimed_at = NULL,
        updated_at = NOW()
      WHERE id = p_event_id;
    ELSE
      -- Max retries exceeded - mark failed
      UPDATE agent_events
      SET
        status = 'failed',
        last_error = p_error,
        updated_at = NOW()
      WHERE id = p_event_id;
    END IF;
  END IF;

  RETURN TRUE;
END;
$$;

-- ============================================================
-- Function: get_pending_events()
-- Read-only view of pending events for monitoring
-- ============================================================
CREATE OR REPLACE FUNCTION get_pending_events(
  p_event_type TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  id UUID,
  event_type TEXT,
  source_agent TEXT,
  target_agent TEXT,
  status TEXT,
  priority INTEGER,
  created_at TIMESTAMPTZ,
  process_after TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  retry_count INTEGER
)
LANGUAGE sql
AS $$
  SELECT
    id,
    event_type,
    source_agent,
    target_agent,
    status,
    priority,
    created_at,
    process_after,
    expires_at,
    retry_count
  FROM agent_events
  WHERE status IN ('pending', 'claimed', 'processing')
    AND (p_event_type IS NULL OR event_type = p_event_type)
  ORDER BY priority ASC, created_at ASC
  LIMIT p_limit;
$$;

-- ============================================================
-- Function: get_event_chain()
-- Recursive CTE for chain visualization
-- ============================================================
CREATE OR REPLACE FUNCTION get_event_chain(p_event_id UUID)
RETURNS TABLE (
  id UUID,
  event_type TEXT,
  source_agent TEXT,
  status TEXT,
  chain_depth INTEGER,
  created_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
)
LANGUAGE sql
AS $$
  WITH RECURSIVE chain AS (
    -- Get root event
    SELECT
      e.id,
      e.event_type,
      e.source_agent,
      e.status,
      e.chain_depth,
      e.created_at,
      e.completed_at,
      e.root_event_id
    FROM agent_events e
    WHERE e.id = p_event_id

    UNION ALL

    -- Get all children
    SELECT
      e.id,
      e.event_type,
      e.source_agent,
      e.status,
      e.chain_depth,
      e.created_at,
      e.completed_at,
      e.root_event_id
    FROM agent_events e
    JOIN chain c ON e.parent_event_id = c.id
  )
  SELECT
    id,
    event_type,
    source_agent,
    status,
    chain_depth,
    created_at,
    completed_at
  FROM chain
  ORDER BY chain_depth ASC, created_at ASC;
$$;

-- ============================================================
-- Function: expire_stale_events()
-- Cleanup expired events - call via cron
-- ============================================================
CREATE OR REPLACE FUNCTION expire_stale_events()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_expired_count INTEGER;
BEGIN
  WITH expired AS (
    UPDATE agent_events
    SET
      status = 'expired',
      updated_at = NOW()
    WHERE status IN ('pending', 'claimed')
      AND expires_at < NOW()
    RETURNING id
  )
  SELECT COUNT(*) INTO v_expired_count FROM expired;

  RETURN v_expired_count;
END;
$$;

-- ============================================================
-- Enable RLS
-- ============================================================
ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_event_metrics ENABLE ROW LEVEL SECURITY;

-- Service role access policies
CREATE POLICY "Service role access for agent_events"
  ON agent_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role access for agent_subscriptions"
  ON agent_subscriptions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role access for agent_event_metrics"
  ON agent_event_metrics
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- Default Subscriptions
-- ============================================================
INSERT INTO agent_subscriptions (agent, event_type, enabled) VALUES
  -- David researches new opportunities
  ('david', 'NEW_OPPORTUNITY', TRUE),

  -- Marcus does tech assessment after research
  ('marcus', 'RESEARCH_COMPLETE', TRUE),

  -- Rosa checks relationships after research
  ('rosa', 'RESEARCH_COMPLETE', TRUE),

  -- James waits for all assessments
  ('james', 'RESEARCH_COMPLETE', TRUE),
  ('james', 'TECH_ASSESSMENT_COMPLETE', TRUE),
  ('james', 'RELATIONSHIP_CHECK_COMPLETE', TRUE),

  -- Patricia schedules pursuits after go/no-go
  ('patricia', 'GO_NO_GO_DECISION', TRUE),
  ('patricia', 'DEADLINE_WARNING', TRUE),
  ('patricia', 'PIPELINE_HEALTH_CHECK', TRUE),

  -- Marcus drafts solution architecture on GO
  ('marcus', 'GO_NO_GO_DECISION', TRUE),

  -- Maya learns from outcomes
  ('maya', 'PURSUIT_DECISION_FEEDBACK', TRUE),
  ('maya', 'OUTCOME_RECORDED', TRUE)
ON CONFLICT (agent, event_type) DO UPDATE SET
  enabled = EXCLUDED.enabled,
  updated_at = NOW();

-- ============================================================
-- Comments
-- ============================================================
COMMENT ON TABLE agent_events IS 'Event bus for agent-to-agent coordination. Agents publish and claim events to react to each other in real-time.';
COMMENT ON TABLE agent_subscriptions IS 'Defines which agents listen to which event types. Enables decoupled event routing.';
COMMENT ON TABLE agent_event_metrics IS 'Hourly aggregations of event processing for performance monitoring.';
COMMENT ON FUNCTION publish_event IS 'Atomically publish an event with automatic chain tracking.';
COMMENT ON FUNCTION claim_events IS 'Atomically claim pending events for processing using FOR UPDATE SKIP LOCKED.';
COMMENT ON FUNCTION complete_event IS 'Mark an event as completed or failed with optional retry.';
COMMENT ON FUNCTION get_event_chain IS 'Visualize the full chain of events from a starting event.';
COMMENT ON FUNCTION expire_stale_events IS 'Cleanup function to mark expired events - call via cron.';
