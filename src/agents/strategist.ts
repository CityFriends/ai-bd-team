import { BaseAgent } from './base-agent.js';
import {
  STRATEGIST_SYSTEM_PROMPT,
  STRATEGIST_SYNTHESIS_PROMPT,
  STRATEGIST_STANDUP_PROMPT,
  STRATEGIST_RESPONSE_PROMPT,
} from '../prompts/strategist.js';
import {
  getOpportunity,
  updateOpportunity,
  getActiveOpportunities,
  getOutreachByOpportunity,
} from '../integrations/supabase.js';
import type { AgentName, Opportunity } from '../types/index.js';

export class StrategistAgent extends BaseAgent {
  name: AgentName = 'strategist';
  displayName = 'Strategist';
  systemPrompt = STRATEGIST_SYSTEM_PROMPT;

  async handleAction(action: string, payload: Record<string, unknown>): Promise<void> {
    switch (action) {
      case 'synthesize_opportunity':
        await this.synthesizeOpportunity(payload.opportunity_id as string);
        break;
      case 'morning_standup':
        await this.runMorningStandup();
        break;
      case 'respond':
        await this.respond(
          payload.message as string,
          payload.thread_ts as string | undefined,
          payload.opportunity_id as string | undefined
        );
        break;
      default:
        console.log(`Strategist: Unknown action ${action}`);
    }
  }

  // Synthesize team input and make a recommendation
  async synthesizeOpportunity(opportunityId: string): Promise<void> {
    console.log(`Strategist: Synthesizing opportunity ${opportunityId}...`);

    try {
      const opp = await getOpportunity(opportunityId);
      if (!opp) {
        console.error(`Strategist: Opportunity ${opportunityId} not found`);
        return;
      }

      // Get outreach status if any
      const outreach = await getOutreachByOpportunity(opportunityId);
      const hasPartners = outreach.length > 0;

      // Build synthesis context
      const synthesisContext = `
Opportunity: ${opp.title}
Agency: ${opp.agency || 'Unknown'}
Type: ${opp.type}
Due Date: ${opp.due_date || 'Not specified'}
Estimated Value: ${opp.est_value || 'Unknown'}

Scout's Assessment:
- Fit Score: ${opp.fit_score}/100
- Reasoning: ${opp.fit_reasoning}
- Keywords Matched: ${opp.keywords_matched?.join(', ') || 'None'}

Current Status: ${opp.status}
Partner Outreach: ${hasPartners ? `${outreach.length} drafts prepared` : 'None yet'}

Description:
${opp.description || 'No description available'}`;

      const synthesis = await this.generateResponse(
        STRATEGIST_SYNTHESIS_PROMPT + '\n\n' + synthesisContext,
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

      // Extract recommendation from synthesis
      const isGo = synthesis.toLowerCase().includes('recommendation: go') ||
        synthesis.toLowerCase().includes('recommend: go') ||
        synthesis.toLowerCase().includes('should pursue');

      const isNoGo = synthesis.toLowerCase().includes('recommendation: no-go') ||
        synthesis.toLowerCase().includes('recommend: no-go') ||
        synthesis.toLowerCase().includes('should pass');

      // Format the decision request
      let message = `*${opp.title}*\n\n${synthesis}\n\n`;

      if (isGo || isNoGo || opp.fit_score && opp.fit_score >= 60) {
        // Request decision from Lapedra
        message += `---\n`;
        message += `*Decision Needed*\n`;
        message += `Recommendation: ${isGo ? 'GO' : isNoGo ? 'NO-GO' : 'Your call'}\n`;
        message += `Investment: ~${estimateHours(opp)} hours\n`;
        message += `Due: ${opp.due_date || 'TBD'}\n\n`;
        message += `@Lapedra - pursue or pass?`;

        await this.requestDecision(message);
      } else {
        // Just post the synthesis, no decision needed
        await this.post(message);
      }
    } catch (error) {
      console.error('Strategist: Error synthesizing opportunity:', error);
      await this.post(`Need to circle back on that synthesis. Hit a snag.`);
    }
  }

  // Run the morning standup
  async runMorningStandup(): Promise<void> {
    console.log('Strategist: Running morning standup...');

    try {
      const activeOpps = await getActiveOpportunities();

      if (activeOpps.length === 0) {
        await this.post(
          `Morning team. Pipeline's empty - no active pursuits.\n\n` +
          `@Scout - anything interesting overnight?`
        );
        return;
      }

      // Group by status
      const pursuing = activeOpps.filter(o => o.status === 'pursuing');
      const researching = activeOpps.filter(o => o.status === 'researching');
      const newOpps = activeOpps.filter(o => o.status === 'new');

      // Build standup message
      let message = `*Morning Standup*\n\n`;

      if (pursuing.length > 0) {
        message += `*Active Pursuits (${pursuing.length}):*\n`;
        for (const opp of pursuing) {
          const outreach = await getOutreachByOpportunity(opp.id);
          message += `• ${opp.title} (${opp.agency || 'Unknown'})`;
          message += ` - Due ${opp.due_date || 'TBD'}`;
          if (outreach.length > 0) {
            const sent = outreach.filter(o => o.email_sent).length;
            message += ` | ${sent}/${outreach.length} outreach sent`;
          }
          message += `\n`;
        }
        message += `\n`;
      }

      if (researching.length > 0) {
        message += `*In Research (${researching.length}):*\n`;
        for (const opp of researching) {
          message += `• ${opp.title} - ${opp.fit_score}/100 fit\n`;
        }
        message += `\n`;
      }

      if (newOpps.length > 0) {
        message += `*Pending Review (${newOpps.length}):*\n`;
        message += `${newOpps.length} new opportunities need triage.\n\n`;
      }

      // Pending decisions
      const pendingDecisions = activeOpps.filter(o => o.decision === 'pending');
      if (pendingDecisions.length > 0) {
        message += `*Awaiting Decision:*\n`;
        for (const opp of pendingDecisions) {
          message += `• ${opp.title} - @Lapedra\n`;
        }
        message += `\n`;
      }

      // Today's priorities
      message += `*Today's Priorities:*\n`;
      if (newOpps.length > 0) {
        message += `• Triage ${newOpps.length} new opportunities\n`;
      }
      if (researching.length > 0) {
        message += `• Complete research on ${researching.length} opportunities\n`;
      }
      if (pursuing.length > 0) {
        const nearDeadline = pursuing.filter(o => {
          if (!o.due_date) return false;
          const dueDate = new Date(o.due_date);
          const daysUntilDue = (dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
          return daysUntilDue <= 14;
        });
        if (nearDeadline.length > 0) {
          message += `• Focus on ${nearDeadline.length} opportunities due within 2 weeks\n`;
        }
      }

      await this.post(message);
    } catch (error) {
      console.error('Strategist: Error running standup:', error);
      await this.post(`Morning team. Standup report hit a glitch - checking the pipeline manually.`);
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
      STRATEGIST_RESPONSE_PROMPT + '\n\nMessage to respond to: ' + message,
      context
    );

    if (threadTs) {
      await this.reply(response, threadTs);
    } else {
      await this.post(response);
    }
  }
}

// Estimate hours based on opportunity type
function estimateHours(opp: Opportunity): string {
  const type = opp.type?.toLowerCase() || '';

  if (type.includes('rfi') || type.includes('sources sought')) {
    return '20-40';
  } else if (type.includes('rfq')) {
    return '40-80';
  } else if (type.includes('rfp')) {
    return '80-160';
  }

  return '40-60';
}

// Export singleton instance
export const strategist = new StrategistAgent();
