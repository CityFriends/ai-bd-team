import { BaseAgent } from './base-agent.js';
import { ANALYST_SYSTEM_PROMPT, ANALYST_RESEARCH_PROMPT, ANALYST_RESPONSE_PROMPT } from '../prompts/analyst.js';
import { getOpportunity, updateOpportunity, getAgency, upsertAgency, queueAgentTask } from '../integrations/supabase.js';
import { researchAgency } from '../integrations/claude.js';
import type { AgentName, Opportunity, AGENT_DELAYS } from '../types/index.js';

export class AnalystAgent extends BaseAgent {
  name: AgentName = 'analyst';
  displayName = 'Analyst';
  systemPrompt = ANALYST_SYSTEM_PROMPT;

  async handleAction(action: string, payload: Record<string, unknown>): Promise<void> {
    switch (action) {
      case 'research_opportunity':
        await this.researchOpportunity(payload.opportunity_id as string);
        break;
      case 'respond':
        await this.respond(
          payload.message as string,
          payload.thread_ts as string | undefined,
          payload.opportunity_id as string | undefined
        );
        break;
      default:
        console.log(`Analyst: Unknown action ${action}`);
    }
  }

  // Research an opportunity in depth
  async researchOpportunity(opportunityId: string): Promise<void> {
    console.log(`Analyst: Researching opportunity ${opportunityId}...`);

    try {
      const opp = await getOpportunity(opportunityId);
      if (!opp) {
        console.error(`Analyst: Opportunity ${opportunityId} not found`);
        return;
      }

      // Update status to researching
      await updateOpportunity(opportunityId, { status: 'researching' });

      // Research the agency if we have one
      let agencyInsights = '';
      if (opp.agency) {
        const existingAgency = await getAgency(opp.agency);
        const research = await researchAgency(opp.agency, existingAgency?.research_notes || undefined);

        // Save agency research
        await upsertAgency({
          name: opp.agency,
          abbreviation: opp.agency,
          tech_stack: research.tech_stack,
          pain_points: research.pain_points,
          research_notes: research.research_notes,
          last_researched: new Date().toISOString(),
        });

        agencyInsights = `
Agency Intelligence (${opp.agency}):
- Tech Stack: ${research.tech_stack}
- Pain Points: ${research.pain_points}
- Notes: ${research.research_notes}`;
      }

      // Generate the research analysis
      const researchContext = `
Opportunity: ${opp.title}
Agency: ${opp.agency || 'Unknown'}
Type: ${opp.type}
Due Date: ${opp.due_date || 'Not specified'}
Description: ${opp.description || 'No description available'}
Scout's Fit Score: ${opp.fit_score}/100
Scout's Take: ${opp.fit_reasoning}
Keywords Matched: ${opp.keywords_matched?.join(', ') || 'None'}
${agencyInsights}`;

      const analysis = await this.generateResponse(
        ANALYST_RESEARCH_PROMPT + '\n\n' + researchContext,
        {
          opportunity: {
            title: opp.title,
            agency: opp.agency || 'Unknown',
            type: opp.type || 'Unknown',
            due_date: opp.due_date || 'Not specified',
            description: opp.description || '',
            fit_score: opp.fit_score || undefined,
          },
        }
      );

      // Post the analysis
      const message = `*Research: ${opp.title}*\n\n${analysis}`;

      // Determine who to tag based on the analysis
      const isPositive = analysis.toLowerCase().includes('worth pursuing') ||
        analysis.toLowerCase().includes('recommend') ||
        analysis.toLowerCase().includes('should consider');

      const mentions: AgentName[] = isPositive ? ['strategist', 'connector'] : ['strategist'];
      await this.postWithMentions(message, mentions);

      // Schedule strategist synthesis
      const { AGENT_DELAYS } = await import('../types/index.js');
      const delay = this.getRandomDelay(AGENT_DELAYS.SYNTHESIS);
      await queueAgentTask(
        'strategist',
        'synthesize_opportunity',
        new Date(Date.now() + delay),
        { opportunity_id: opportunityId },
        opportunityId
      );

      // If positive, also schedule connector for partner search
      if (isPositive) {
        const connectorDelay = this.getRandomDelay(AGENT_DELAYS.PARTNER_SEARCH);
        await queueAgentTask(
          'connector',
          'find_partners',
          new Date(Date.now() + connectorDelay),
          { opportunity_id: opportunityId },
          opportunityId
        );
      }
    } catch (error) {
      console.error('Analyst: Error researching opportunity:', error);
      await this.post(`Hit a wall researching that opportunity. Will circle back.`);
    }
  }

  // Respond to a message
  async respond(message: string, threadTs?: string, opportunityId?: string): Promise<void> {
    let context = undefined;

    if (opportunityId) {
      const opp = await getOpportunity(opportunityId);
      if (opp) {
        context = {
          opportunity: {
            title: opp.title,
            agency: opp.agency || 'Unknown',
            type: opp.type || 'Unknown',
            due_date: opp.due_date || 'Not specified',
            description: opp.description || '',
            fit_score: opp.fit_score || undefined,
          },
        };
      }
    }

    const response = await this.generateResponse(
      ANALYST_RESPONSE_PROMPT + '\n\nMessage to respond to: ' + message,
      context
    );

    if (threadTs) {
      await this.reply(response, threadTs);
    } else {
      await this.post(response);
    }
  }
}

// Export singleton instance
export const analyst = new AnalystAgent();
