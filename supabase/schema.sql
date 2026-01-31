-- BD Team AI Agents Database Schema
-- Run this in your Supabase SQL editor

-- Opportunities from SAM.gov
CREATE TABLE IF NOT EXISTS opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sam_id TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  agency TEXT,
  office TEXT,
  type TEXT, -- RFI, RFQ, RFP, Sources Sought
  naics_codes TEXT[],
  posted_date DATE,
  due_date DATE,
  est_value TEXT,
  description TEXT,
  sam_url TEXT,
  attachments JSONB DEFAULT '[]',

  -- Scout's analysis
  fit_score INTEGER,
  fit_reasoning TEXT,
  keywords_matched TEXT[],

  -- Status
  status TEXT DEFAULT 'new', -- new, researching, pursuing, passed, submitted, won, lost
  decision TEXT, -- go, no_go, pending
  decision_date TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agency intelligence
CREATE TABLE IF NOT EXISTS agencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  abbreviation TEXT UNIQUE,
  key_offices TEXT,
  tech_stack TEXT,
  pain_points TEXT,
  key_personnel JSONB DEFAULT '[]',
  our_history TEXT,
  research_notes TEXT,
  last_researched TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Teaming partners
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  duns TEXT,
  cage_code TEXT,
  sam_uei TEXT,
  website TEXT,
  size TEXT, -- small, large
  certifications TEXT[], -- 8a, WOSB, SDVOSB, HUBZone
  naics_codes TEXT[],
  capabilities TEXT,
  past_agencies TEXT[],
  primary_contact JSONB,
  relationship_status TEXT DEFAULT 'none', -- none, researched, contacted, met, teamed
  relationship_notes TEXT,
  last_contact_date DATE,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Outreach tracking
CREATE TABLE IF NOT EXISTS outreach (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  opportunity_id UUID REFERENCES opportunities(id),
  email_subject TEXT,
  email_draft TEXT,
  email_approved BOOLEAN DEFAULT FALSE,
  email_sent BOOLEAN DEFAULT FALSE,
  email_sent_date TIMESTAMPTZ,
  response_received BOOLEAN DEFAULT FALSE,
  response_summary TEXT,
  status TEXT DEFAULT 'draft', -- draft, approved, sent, responded, meeting, declined, agreed
  next_step TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Conversation threads (for agent coordination)
CREATE TABLE IF NOT EXISTS conversation_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_thread_ts TEXT,
  slack_channel TEXT,
  opportunity_id UUID REFERENCES opportunities(id),
  topic TEXT, -- opportunity_review, partner_search, capture_planning, standup
  status TEXT DEFAULT 'active', -- active, resolved, stale
  agents_involved TEXT[],
  awaiting_response_from TEXT, -- lapedra, scout, analyst, etc.
  context_summary TEXT,
  key_decisions JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agent task queue (coordination + delays)
CREATE TABLE IF NOT EXISTS agent_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent TEXT NOT NULL,
  action TEXT NOT NULL,
  opportunity_id UUID REFERENCES opportunities(id),
  thread_ts TEXT,
  payload JSONB DEFAULT '{}',
  scheduled_for TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending', -- pending, running, completed, failed, cancelled
  result JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status);
CREATE INDEX IF NOT EXISTS idx_opportunities_due_date ON opportunities(due_date);
CREATE INDEX IF NOT EXISTS idx_opportunities_sam_id ON opportunities(sam_id);
CREATE INDEX IF NOT EXISTS idx_agent_queue_status ON agent_queue(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_agent_queue_agent ON agent_queue(agent);
CREATE INDEX IF NOT EXISTS idx_threads_opportunity ON conversation_threads(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_threads_slack_ts ON conversation_threads(slack_thread_ts);
CREATE INDEX IF NOT EXISTS idx_companies_naics ON companies USING GIN(naics_codes);
CREATE INDEX IF NOT EXISTS idx_outreach_opportunity ON outreach(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_outreach_company ON outreach(company_id);

-- Enable Row Level Security (optional, but recommended)
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_queue ENABLE ROW LEVEL SECURITY;

-- Create policies to allow service role full access
CREATE POLICY "Service role has full access to opportunities" ON opportunities
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to agencies" ON agencies
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to companies" ON companies
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to outreach" ON outreach
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to conversation_threads" ON conversation_threads
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to agent_queue" ON agent_queue
  FOR ALL USING (auth.role() = 'service_role');
