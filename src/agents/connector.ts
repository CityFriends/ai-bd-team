import { BaseAgent } from './base-agent.js';
import { CONNECTOR_SYSTEM_PROMPT, CONNECTOR_PARTNER_SEARCH_PROMPT, CONNECTOR_RESPONSE_PROMPT } from '../prompts/connector.js';
import {
  getOpportunity,
  searchCompaniesByNaics,
  searchCompaniesByCapabilities,
  createCompany,
  createOutreach,
  updateOutreach,
  getOutreachByOpportunity,
} from '../integrations/supabase.js';
import { generateOutreachEmail } from '../integrations/claude.js';
import type { AgentName, Company, Opportunity } from '../types/index.js';

export class ConnectorAgent extends BaseAgent {
  name: AgentName = 'connector';
  displayName = 'Connector';
  systemPrompt = CONNECTOR_SYSTEM_PROMPT;

  async handleAction(action: string, payload: Record<string, unknown>): Promise<void> {
    switch (action) {
      case 'find_partners':
        await this.findPartners(payload.opportunity_id as string);
        break;
      case 'draft_outreach':
        await this.draftOutreach(
          payload.opportunity_id as string,
          payload.company_ids as string[]
        );
        break;
      case 'respond':
        await this.respond(
          payload.message as string,
          payload.thread_ts as string | undefined,
          payload.opportunity_id as string | undefined
        );
        break;
      default:
        console.log(`Connector: Unknown action ${action}`);
    }
  }

  // Find potential teaming partners for an opportunity
  async findPartners(opportunityId: string): Promise<void> {
    console.log(`Connector: Finding partners for opportunity ${opportunityId}...`);

    try {
      const opp = await getOpportunity(opportunityId);
      if (!opp) {
        console.error(`Connector: Opportunity ${opportunityId} not found`);
        return;
      }

      // Search for partners by NAICS codes and keywords
      const naicsPartners = opp.naics_codes
        ? await searchCompaniesByNaics(opp.naics_codes)
        : [];

      const keywords = opp.keywords_matched || ['digital services', 'user experience', 'agile'];
      const capabilityPartners = await searchCompaniesByCapabilities(keywords);

      // Combine and dedupe
      const allPartners = [...naicsPartners, ...capabilityPartners];
      const uniquePartners = Array.from(
        new Map(allPartners.map(p => [p.id, p])).values()
      );

      // Generate partner analysis
      const partnerContext = `
Opportunity: ${opp.title}
Agency: ${opp.agency || 'Unknown'}
Type: ${opp.type}
NAICS: ${opp.naics_codes?.join(', ') || 'Not specified'}
Keywords: ${opp.keywords_matched?.join(', ') || 'None'}
Description: ${opp.description || 'No description'}

Known Partners in Database: ${uniquePartners.length}
${uniquePartners.map(p => `- ${p.name}: ${p.capabilities || 'No capabilities listed'} (${p.relationship_status})`).join('\n')}`;

      const analysis = await this.generateResponse(
        CONNECTOR_PARTNER_SEARCH_PROMPT + '\n\n' + partnerContext,
        {
          opportunity: {
            title: opp.title,
            agency: opp.agency || 'Unknown',
            type: opp.type || 'Unknown',
            due_date: opp.due_date || 'Not specified',
            description: opp.description || '',
          },
        }
      );

      // Post the partner recommendations
      let message = `*Partner Search: ${opp.title}*\n\n${analysis}\n\n`;

      // Ask for permission to draft outreach
      if (uniquePartners.length > 0 || analysis.toLowerCase().includes('recommend')) {
        message += `@Lapedra - okay if I draft outreach emails to the top prospects? Won't send anything without your review.`;
        await this.requestDecision(message);
      } else {
        message += `@Strategist - slim pickings on the partner front for this one. May need to expand the search or go it alone.`;
        await this.postWithMentions(message, ['strategist']);
      }
    } catch (error) {
      console.error('Connector: Error finding partners:', error);
      await this.post(`Hit a snag researching partners. Let me try a different angle.`);
    }
  }

  // Draft outreach emails (only after permission)
  async draftOutreach(opportunityId: string, companyIds: string[]): Promise<void> {
    console.log(`Connector: Drafting outreach for ${companyIds.length} companies...`);

    try {
      const opp = await getOpportunity(opportunityId);
      if (!opp) {
        console.error(`Connector: Opportunity ${opportunityId} not found`);
        return;
      }

      const drafts: Array<{ company: string; subject: string; preview: string }> = [];

      for (const companyId of companyIds) {
        const { getCompany } = await import('../integrations/supabase.js');
        const company = await getCompany(companyId);
        if (!company) continue;

        // Generate the email draft
        const email = await generateOutreachEmail(
          company.name,
          opp.title,
          opp.description || '',
          company.capabilities || ''
        );

        // Save the outreach draft
        await createOutreach({
          company_id: companyId,
          opportunity_id: opportunityId,
          email_subject: email.subject,
          email_draft: email.body,
          status: 'draft',
        });

        drafts.push({
          company: company.name,
          subject: email.subject,
          preview: email.body.substring(0, 100) + '...',
        });
      }

      // Post summary of drafts
      let message = `*Outreach Drafts Ready: ${opp.title}*\n\n`;
      for (const draft of drafts) {
        message += `*${draft.company}*\n`;
        message += `Subject: ${draft.subject}\n`;
        message += `Preview: ${draft.preview}\n\n`;
      }

      message += `@Lapedra - drafts are ready for your review. Let me know if you want any changes before I show you the full versions.`;
      await this.requestDecision(message);
    } catch (error) {
      console.error('Connector: Error drafting outreach:', error);
      await this.post(`Ran into trouble drafting those emails. Let me try again.`);
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
          },
        };
      }
    }

    const response = await this.generateResponse(
      CONNECTOR_RESPONSE_PROMPT + '\n\nMessage to respond to: ' + message,
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
export const connector = new ConnectorAgent();
