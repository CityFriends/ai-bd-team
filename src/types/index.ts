// Agent types
export type AgentName =
  | 'scout'
  | 'analyst'
  | 'connector'
  | 'strategist'
  | 'pm'
  | 'engineer'
  | 'writer';

export interface Agent {
  name: AgentName;
  displayName: string;
  emoji: string;
}

export const AGENTS: Record<AgentName, Agent> = {
  scout: { name: 'scout', displayName: 'Scout', emoji: '🔍' },
  analyst: { name: 'analyst', displayName: 'Analyst', emoji: '📊' },
  connector: { name: 'connector', displayName: 'Connector', emoji: '🤝' },
  strategist: { name: 'strategist', displayName: 'Strategist', emoji: '🎯' },
  pm: { name: 'pm', displayName: 'PM', emoji: '📋' },
  engineer: { name: 'engineer', displayName: 'Engineer', emoji: '⚙️' },
  writer: { name: 'writer', displayName: 'Writer', emoji: '✍️' },
};

// Opportunity types
export type OpportunityType = 'RFI' | 'RFQ' | 'RFP' | 'Sources Sought' | 'Other';
export type OpportunityStatus =
  | 'new'
  | 'researching'
  | 'pursuing'
  | 'passed'
  | 'submitted'
  | 'won'
  | 'lost';
export type Decision = 'go' | 'no_go' | 'pending';

export interface Opportunity {
  id: string;
  sam_id: string;
  title: string;
  agency: string | null;
  office: string | null;
  type: OpportunityType | null;
  naics_codes: string[] | null;
  posted_date: string | null;
  due_date: string | null;
  est_value: string | null;
  description: string | null;
  sam_url: string | null;
  attachments: unknown[];
  fit_score: number | null;
  fit_reasoning: string | null;
  keywords_matched: string[] | null;
  status: OpportunityStatus;
  decision: Decision | null;
  decision_date: string | null;
  created_at: string;
  updated_at: string;
}

// Agency types
export interface Agency {
  id: string;
  name: string;
  abbreviation: string | null;
  key_offices: string | null;
  tech_stack: string | null;
  pain_points: string | null;
  key_personnel: unknown[];
  our_history: string | null;
  research_notes: string | null;
  last_researched: string | null;
  created_at: string;
  updated_at: string;
}

// Company/Partner types
export type CompanySize = 'small' | 'large';
export type RelationshipStatus = 'none' | 'researched' | 'contacted' | 'met' | 'teamed';

export interface Company {
  id: string;
  name: string;
  duns: string | null;
  cage_code: string | null;
  sam_uei: string | null;
  website: string | null;
  size: CompanySize | null;
  certifications: string[] | null;
  naics_codes: string[] | null;
  capabilities: string | null;
  past_agencies: string[] | null;
  primary_contact: {
    name?: string;
    email?: string;
    phone?: string;
    title?: string;
  } | null;
  relationship_status: RelationshipStatus;
  relationship_notes: string | null;
  last_contact_date: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
}

// Outreach types
export type OutreachStatus =
  | 'draft'
  | 'approved'
  | 'sent'
  | 'responded'
  | 'meeting'
  | 'declined'
  | 'agreed';

export interface Outreach {
  id: string;
  company_id: string;
  opportunity_id: string | null;
  email_subject: string | null;
  email_draft: string | null;
  email_approved: boolean;
  email_sent: boolean;
  email_sent_date: string | null;
  response_received: boolean;
  response_summary: string | null;
  status: OutreachStatus;
  next_step: string | null;
  created_at: string;
  updated_at: string;
}

// Conversation thread types
export type ThreadTopic = 'opportunity_review' | 'partner_search' | 'capture_planning' | 'standup';
export type ThreadStatus = 'active' | 'resolved' | 'stale';

export interface ConversationThread {
  id: string;
  slack_thread_ts: string | null;
  slack_channel: string | null;
  opportunity_id: string | null;
  topic: ThreadTopic | null;
  status: ThreadStatus;
  agents_involved: string[] | null;
  awaiting_response_from: string | null;
  context_summary: string | null;
  key_decisions: unknown[];
  created_at: string;
  updated_at: string;
}

// Agent queue types
export type QueueStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface AgentQueueItem {
  id: string;
  agent: AgentName;
  action: string;
  opportunity_id: string | null;
  thread_ts: string | null;
  payload: Record<string, unknown>;
  scheduled_for: string;
  started_at: string | null;
  completed_at: string | null;
  status: QueueStatus;
  result: unknown | null;
  created_at: string;
}

// SAM.gov API types
export interface SAMOpportunity {
  noticeId: string;
  title: string;
  solicitationNumber?: string;
  department?: string;
  subTier?: string;
  office?: string;
  postedDate: string;
  type: string;
  baseType: string;
  archiveType?: string;
  archiveDate?: string;
  setAsideDescription?: string;
  setAside?: string;
  responseDeadLine?: string;
  naicsCode?: string;
  classificationCode?: string;
  active: string;
  description?: string;
  organizationType?: string;
  additionalInfoLink?: string;
  uiLink?: string;
  links?: Array<{ rel: string; href: string }>;
  resourceLinks?: string[];
  pointOfContact?: Array<{
    type: string;
    title?: string;
    fullName?: string;
    email?: string;
    phone?: string;
  }>;
  award?: {
    date?: string;
    number?: string;
    amount?: string;
    awardee?: {
      name?: string;
      ueiSAM?: string;
    };
  };
}

export interface SAMSearchResponse {
  totalRecords: number;
  limit: number;
  offset: number;
  opportunitiesData: SAMOpportunity[];
}

// Scoring types
export interface OpportunityScore {
  total: number;
  breakdown: {
    keywords: number;
    agency: number;
    setAside: number;
    type: number;
    timeline: number;
  };
  reasoning: string;
  keywords_matched: string[];
}

// Agent message types
export interface AgentMessage {
  agent: AgentName;
  content: string;
  thread_ts?: string;
  opportunity_id?: string;
  mentions?: AgentName[];
}

// Delay ranges for natural timing
export const AGENT_DELAYS = {
  QUICK_RESPONSE: [2 * 60000, 5 * 60000] as [number, number],
  RESEARCH: [15 * 60000, 30 * 60000] as [number, number],
  SYNTHESIS: [10 * 60000, 20 * 60000] as [number, number],
  PARTNER_SEARCH: [20 * 60000, 40 * 60000] as [number, number],
} as const;
