import { BaseAgent } from './base-agent.js';
import { SCOUT_SYSTEM_PROMPT, SCOUT_DAILY_SCAN_PROMPT, SCOUT_RESPONSE_PROMPT } from '../prompts/scout.js';
import { getDailyOpportunities, mapOpportunityType, extractAgencyAbbreviation } from '../integrations/sam-gov.js';
import { analyzeOpportunityFit } from '../integrations/claude.js';
import { createOpportunity, getOpportunityBySamId } from '../integrations/supabase.js';
import type { AgentName, SAMOpportunity, AGENT_DELAYS, Opportunity } from '../types/index.js';

export class ScoutAgent extends BaseAgent {
  name: AgentName = 'scout';
  displayName = 'Scout';
  systemPrompt = SCOUT_SYSTEM_PROMPT;

  async handleAction(action: string, payload: Record<string, unknown>): Promise<void> {
    switch (action) {
      case 'daily_scan':
        await this.runDailyScan();
        break;
      case 'respond':
        await this.respond(payload.message as string, payload.thread_ts as string | undefined);
        break;
      default:
        console.log(`Scout: Unknown action ${action}`);
    }
  }

  // Run the daily opportunity scan
  async runDailyScan(): Promise<void> {
    console.log('Scout: Starting daily scan...');

    try {
      // Fetch opportunities from SAM.gov
      const samOpportunities = await getDailyOpportunities();
      console.log(`Scout: Found ${samOpportunities.length} opportunities from SAM.gov`);

      if (samOpportunities.length === 0) {
        await this.post("Morning team. Quiet night on SAM.gov - nothing new in our NAICS codes. I'll keep watching.");
        return;
      }

      // Process and score each opportunity
      const processedOpps: Array<{ opp: Opportunity; score: number }> = [];

      for (const samOpp of samOpportunities) {
        // Check if we already have this opportunity
        const existing = await getOpportunityBySamId(samOpp.noticeId);
        if (existing) {
          continue;
        }

        // Analyze fit
        const fitAnalysis = await analyzeOpportunityFit(
          samOpp.title,
          samOpp.description || '',
          samOpp.department || samOpp.subTier || 'Unknown',
          mapOpportunityType(samOpp.type)
        );

        // Create opportunity record
        const opp = await createOpportunity({
          sam_id: samOpp.noticeId,
          title: samOpp.title,
          agency: extractAgencyAbbreviation(samOpp.department, samOpp.subTier) || samOpp.department || null,
          office: samOpp.office || null,
          type: mapOpportunityType(samOpp.type) as Opportunity['type'],
          naics_codes: samOpp.naicsCode ? [samOpp.naicsCode] : null,
          posted_date: samOpp.postedDate || null,
          due_date: samOpp.responseDeadLine || null,
          description: samOpp.description || null,
          sam_url: samOpp.uiLink || null,
          fit_score: fitAnalysis.score,
          fit_reasoning: fitAnalysis.reasoning,
          keywords_matched: fitAnalysis.keywords_matched,
          status: 'new',
        });

        processedOpps.push({ opp, score: fitAnalysis.score });
      }

      // Sort by score
      processedOpps.sort((a, b) => b.score - a.score);

      // Generate and post the daily summary
      await this.postDailySummary(processedOpps, samOpportunities.length);
    } catch (error) {
      console.error('Scout: Error in daily scan:', error);
      await this.post("Morning team. Hit a snag pulling from SAM.gov this morning - I'll retry in a bit.");
    }
  }

  // Post the daily summary to Slack
  private async postDailySummary(
    processedOpps: Array<{ opp: Opportunity; score: number }>,
    totalFromSam: number
  ): Promise<void> {
    const newOpps = processedOpps.length;
    const highFit = processedOpps.filter(p => p.score >= 70);
    const mediumFit = processedOpps.filter(p => p.score >= 50 && p.score < 70);

    // Generate the summary message
    let message = '';

    if (newOpps === 0) {
      message = `Morning team. ${totalFromSam} posted overnight, but all were ones we've already seen or clearly not our thing.`;
    } else {
      message = `Morning team. ${totalFromSam} posted overnight, ${newOpps} new to track.\n\n`;

      if (highFit.length > 0) {
        message += `*Worth discussing (${highFit.length}):*\n\n`;

        for (const { opp } of highFit) {
          message += `*${opp.title}*\n`;
          message += `${opp.type} · ${opp.agency || 'Unknown Agency'}`;
          if (opp.due_date) {
            message += ` · Due ${formatDate(opp.due_date)}`;
          }
          message += `\nFit: ${opp.fit_score}/100\n`;
          message += `${opp.fit_reasoning}\n\n`;
        }

        message += `@Analyst - mind taking a look at ${highFit.length === 1 ? 'this one' : 'these'}?\n`;
      } else if (mediumFit.length > 0) {
        message += `Nothing that made me spill my coffee, but ${mediumFit.length} medium-fit ${mediumFit.length === 1 ? 'opportunity' : 'opportunities'} if we're looking for volume.\n`;
      } else {
        message += `Slim pickings today - nothing scored above 50. I'll keep watching.`;
      }
    }

    // Post the summary
    const mentions: AgentName[] = highFit.length > 0 ? ['analyst'] : [];
    if (mentions.length > 0) {
      await this.postWithMentions(message, mentions);
    } else {
      await this.post(message);
    }

    // If there are high-fit opportunities, schedule Analyst research
    if (highFit.length > 0) {
      const { queueAgentTask } = await import('../integrations/supabase.js');
      const { AGENT_DELAYS } = await import('../types/index.js');

      for (const { opp } of highFit) {
        // Schedule analyst to research with a delay
        const delay = this.getRandomDelay(AGENT_DELAYS.RESEARCH);
        await queueAgentTask(
          'analyst',
          'research_opportunity',
          new Date(Date.now() + delay),
          { opportunity_id: opp.id },
          opp.id
        );
      }
    }
  }

  // Respond to a message in a thread
  async respond(message: string, threadTs?: string): Promise<void> {
    const response = await this.generateResponse(
      SCOUT_RESPONSE_PROMPT + '\n\nMessage to respond to: ' + message
    );

    if (threadTs) {
      await this.reply(response, threadTs);
    } else {
      await this.post(response);
    }
  }
}

// Helper to format dates nicely
function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

// Export singleton instance
export const scout = new ScoutAgent();
