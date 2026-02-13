-- Fix publish_event function to handle root events correctly
-- The FK constraint requires root_event_id to reference an existing row,
-- so we must insert NULL first, then update to self-reference.

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
    -- Root event - will be set to self after insert
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

  -- Insert the event (root_event_id is NULL for root events initially)
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
    v_root_event_id,  -- NULL for root events, valid UUID for chain events
    v_chain_depth,
    p_priority,
    p_channel_id,
    p_thread_ts,
    p_process_after,
    v_default_expires
  )
  RETURNING id INTO v_event_id;

  -- Update root_event_id to self if this is a root event
  IF p_parent_event_id IS NULL THEN
    UPDATE agent_events
    SET root_event_id = v_event_id
    WHERE id = v_event_id;
  END IF;

  RETURN v_event_id;
END;
$$;

COMMENT ON FUNCTION publish_event IS 'Atomically publish an event with automatic chain tracking. Root events self-reference via root_event_id.';
