export { BaseAgent, extractMentions, mentionsLapedra } from './base-agent.js';
export { ScoutAgent, scout } from './scout.js';
export { AnalystAgent, analyst } from './analyst.js';
export { ConnectorAgent, connector } from './connector.js';
export { StrategistAgent, strategist } from './strategist.js';
export { PMAgent, pm } from './pm.js';

import { scout } from './scout.js';
import { analyst } from './analyst.js';
import { connector } from './connector.js';
import { strategist } from './strategist.js';
import { pm } from './pm.js';
import type { AgentName } from '../types/index.js';
import type { BaseAgent } from './base-agent.js';

// Agent registry for easy lookup
// Note: 'engineer' (Marcus) uses live agent system, not legacy BaseAgent
export const agents: Partial<Record<AgentName, BaseAgent>> = {
  scout,
  analyst,
  connector,
  strategist,
  pm,
};

// Get an agent by name
export function getAgent(name: AgentName): BaseAgent | undefined {
  return agents[name];
}
