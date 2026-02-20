-- Create get_pending_events function for agent-specific queries
-- This is an OVERLOAD of the existing get_pending_events(p_event_type, p_limit) function
-- This version returns pending events for a specific agent based on their subscriptions

CREATE OR REPLACE FUNCTION get_pending_events_for_agent(p_agent_name TEXT)
RETURNS SETOF agent_events AS $$
BEGIN
  RETURN QUERY
  SELECT e.*
  FROM agent_events e
  JOIN agent_subscriptions s ON s.event_type = e.event_type
  WHERE s.agent = p_agent_name
    AND s.enabled = true
    AND e.status = 'pending'
    AND (e.target_agent IS NULL OR e.target_agent = p_agent_name)
    AND e.source_agent != p_agent_name
  ORDER BY
    e.priority ASC,  -- Lower number = higher priority (1 is highest)
    e.created_at ASC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_pending_events_for_agent IS 'Returns pending events for a specific agent based on their subscriptions. Used by event processors.';
