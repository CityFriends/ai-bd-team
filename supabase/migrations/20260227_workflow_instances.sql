-- Workflow Instance Tracking
-- Persistent storage for workflow state machines with SLA tracking

-- Workflow instances table
CREATE TABLE IF NOT EXISTS workflow_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Workflow identification
  workflow_type TEXT NOT NULL,  -- 'opportunity_pursuit', 'partner_search', etc.
  reference_id TEXT NOT NULL,   -- e.g., notice_id for opportunities
  reference_title TEXT,         -- Human-readable title

  -- Current state
  current_state TEXT NOT NULL,
  previous_state TEXT,
  state_entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  workflow_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Assignment
  responsible_agent TEXT,       -- Agent currently responsible
  channel_id TEXT,              -- Slack channel
  thread_ts TEXT,               -- Slack thread

  -- Priority and SLA
  priority INTEGER DEFAULT 5 CHECK (priority >= 1 AND priority <= 10),
  sla_deadline TIMESTAMPTZ,     -- When current state SLA expires

  -- Escalation tracking
  escalation_level INTEGER DEFAULT 0,
  is_escalated BOOLEAN DEFAULT FALSE,

  -- Flexible metadata
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for workflow instances
CREATE INDEX IF NOT EXISTS idx_workflow_instances_type ON workflow_instances(workflow_type);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_reference ON workflow_instances(reference_id);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_state ON workflow_instances(current_state);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_agent ON workflow_instances(responsible_agent);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_sla ON workflow_instances(sla_deadline) WHERE sla_deadline IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_instances_active ON workflow_instances(current_state)
  WHERE current_state NOT IN ('passed', 'cancelled', 'completed');

-- State history table for tracking all transitions
CREATE TABLE IF NOT EXISTS workflow_state_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id UUID NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,

  -- Transition details
  from_state TEXT,              -- NULL for initial state
  to_state TEXT NOT NULL,
  transitioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_minutes INTEGER,     -- Time spent in from_state

  -- Who/what triggered the transition
  triggered_by TEXT NOT NULL,   -- 'agent', 'auto', 'human', 'escalation'
  agent TEXT,                   -- Agent name if triggered by agent
  notes TEXT                    -- Additional context
);

-- Indexes for state history
CREATE INDEX IF NOT EXISTS idx_workflow_history_instance ON workflow_state_history(workflow_instance_id);
CREATE INDEX IF NOT EXISTS idx_workflow_history_time ON workflow_state_history(transitioned_at DESC);

-- Escalation log for tracking all escalation actions
CREATE TABLE IF NOT EXISTS workflow_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id UUID NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,

  escalation_level INTEGER NOT NULL,
  action_taken TEXT NOT NULL,   -- 'notify_patricia', 'notify_channel', 'auto_advance', etc.
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Result
  action_successful BOOLEAN,
  result_notes TEXT,

  -- Context
  sla_breach_minutes INTEGER,   -- How many minutes past SLA
  current_state TEXT NOT NULL
);

-- Index for escalations
CREATE INDEX IF NOT EXISTS idx_workflow_escalations_instance ON workflow_escalations(workflow_instance_id);

-- Enable RLS
ALTER TABLE workflow_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_state_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_escalations ENABLE ROW LEVEL SECURITY;

-- Service role policies
CREATE POLICY "Service role has full access to workflow_instances" ON workflow_instances
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role has full access to workflow_state_history" ON workflow_state_history
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role has full access to workflow_escalations" ON workflow_escalations
  FOR ALL USING (auth.role() = 'service_role');

-- Function to get workflows breaching SLA
CREATE OR REPLACE FUNCTION get_breached_workflows()
RETURNS TABLE (
  id UUID,
  workflow_type TEXT,
  reference_id TEXT,
  reference_title TEXT,
  current_state TEXT,
  responsible_agent TEXT,
  sla_deadline TIMESTAMPTZ,
  breach_minutes INTEGER,
  escalation_level INTEGER,
  channel_id TEXT,
  thread_ts TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    wi.id,
    wi.workflow_type,
    wi.reference_id,
    wi.reference_title,
    wi.current_state,
    wi.responsible_agent,
    wi.sla_deadline,
    EXTRACT(EPOCH FROM (NOW() - wi.sla_deadline))::INTEGER / 60 AS breach_minutes,
    wi.escalation_level,
    wi.channel_id,
    wi.thread_ts
  FROM workflow_instances wi
  WHERE wi.sla_deadline < NOW()
    AND wi.current_state NOT IN ('passed', 'cancelled', 'completed')
  ORDER BY wi.sla_deadline ASC;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_breached_workflows() TO service_role;
