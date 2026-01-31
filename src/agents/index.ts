export { BaseAgent, extractMentions, mentionsLapedra } from './base-agent.js';
export { ScoutAgent, scout } from './scout.js';
export { AnalystAgent, analyst } from './analyst.js';
export { ConnectorAgent, connector } from './connector.js';
export { StrategistAgent, strategist } from './strategist.js';

import { scout } from './scout.js';
import { analyst } from './analyst.js';
import { connector } from './connector.js';
import { strategist } from './strategist.js';
import type { AgentName } from '../types/index.js';
import type { BaseAgent } from './base-agent.js';

// Agent registry for easy lookup
export const agents: Record<AgentName, BaseAgent> = {
  scout,
  analyst,
  connector,
  strategist,
};

// Get an agent by name
export function getAgent(name: AgentName): BaseAgent {
  return agents[name];
}
