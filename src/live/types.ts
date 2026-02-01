// Types for the live conversational agent system

export type LiveAgentName = 'maya' | 'david' | 'rosa' | 'james' | 'patricia';

export interface LiveAgentConfig {
  name: LiveAgentName;
  displayName: string;
  botToken: string;
  appToken: string;
  slackUserId?: string; // Populated after connecting
}

export interface IncomingMessage {
  text: string;
  userId: string;
  userName?: string;
  channelId: string;
  threadTs?: string;
  messageTs: string;
  mentionedAgents: LiveAgentName[];
  isDirectMention: boolean;
  isInActiveThread: boolean;
}

export interface ThreadContext {
  threadTs: string;
  messages: ThreadMessage[];
  participants: string[];
  topic?: string;
  opportunityId?: string;
}

export interface ThreadMessage {
  author: string; // 'lapedra', 'maya', 'david', etc.
  text: string;
  ts: string;
}

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface AgentResponse {
  text: string;
  shouldRespond: boolean;
  delayMs: number;
  confidence: number; // How confident the agent is they should respond (0-1)
  sources: string[]; // Sources cited (e.g., 'SAM.gov', 'FPDS', 'inference')
  confidenceLevel: ConfidenceLevel; // HIGH/MEDIUM/LOW based on source quality
  reaction: string | null; // Optional emoji reaction (e.g., 'thumbsup', 'fire')
}

export interface AgentMemoryEntry {
  id?: string;
  agent: LiveAgentName;
  messageTs: string;
  threadTs?: string;
  responseText: string;
  sources: string[];
  confidenceLevel: ConfidenceLevel;
  createdAt?: string;
}

// Map display names to agent keys
export const NAME_TO_AGENT: Record<string, LiveAgentName> = {
  'maya': 'maya',
  'david': 'david',
  'rosa': 'rosa',
  'james': 'james',
  'patricia': 'patricia',
  'scout': 'maya',
  'analyst': 'david',
  'connector': 'rosa',
  'strategist': 'james',
  'pm': 'patricia',
};

// Agent expertise areas (for deciding who should chime in)
export const AGENT_EXPERTISE: Record<LiveAgentName, string[]> = {
  maya: ['opportunities', 'sam.gov', 'new finds', 'fit score', 'keywords', 'initial assessment'],
  david: ['research', 'analysis', 'risks', 'incumbent', 'agency intel', 'red flags', 'concerns', 'due diligence'],
  rosa: ['partners', 'teaming', 'relationships', 'contacts', 'outreach', 'connections', 'introductions'],
  james: ['strategy', 'decision', 'go/no-go', 'win probability', 'approach', 'capture', 'bid'],
  patricia: ['timeline', 'deadlines', 'status', 'standup', 'tracking', 'follow-up', 'action items'],
};
