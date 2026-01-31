import { BaseAgent } from './base-agent.js';
import { CONNECTOR_SYSTEM_PROMPT, CONNECTOR_RESPONSE_PROMPT } from '../prompts/connector.js';
import {
  getOpportunity,
  getAgency,
  searchCompaniesByNaics,
  searchCompaniesByCapabilities,
  createCompany,
  getSupabase,
} from '../integrations/supabase.js';
import { getAnthropic } from '../integrations/claude.js';
import type { AgentName, Opportunity, Company } from '../types/index.js';

interface PartnerRecommendation {
  name: string;
  type: 'existing' | 'suggested';
  why: string;
  certifications?: string[];
  capabilities?: string;
  relationship: string;
  priority: 'high' | 'medium' | 'low';
  companyId?: string;
}

interface TeamingAnalysis {
  should_prime: boolean;
  prime_reasoning: string;
  capabilities_needed: string[];
  certifications_needed: string[];
  partner_types: string[];
}

export class ConnectorAgent extends BaseAgent {
  name: AgentName = 'connector';
  displayName = 'Connector';
  systemPrompt = CONNECTOR_SYSTEM_PROMPT;

  async handleAction(action: string, payload: Record<string, unknown>): Promise<void> {
    switch (action) {
      case 'find_partners':
        await this.findPartners(payload.opportunity_id as string);
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

  // Main partner finding flow
  async findPartners(opportunityId: string): Promise<void> {
    console.log(`Connector: Finding partners for opportunity ${opportunityId}...`);

    try {
      const opp = await getOpportunity(opportunityId);
      if (!opp) {
        console.error(`Connector: Opportunity ${opportunityId} not found`);
        return;
      }

      console.log(`Connector: Analyzing teaming needs for "${opp.title}"...`);

      // Step 1: Analyze teaming needs
      const teamingAnalysis = await this.analyzeTeamingNeeds(opp);
      console.log(`Connector: Should we prime? ${teamingAnalysis.should_prime ? 'Yes' : 'No/Maybe sub'}`);

      // Step 2: Search existing partners in database
      console.log(`Connector: Searching existing partner database...`);
      const existingPartners = await this.searchExistingPartners(opp);
      console.log(`Connector: Found ${existingPartners.length} potential partners in database`);

      // Step 3: Get AI-suggested partner types
      console.log(`Connector: Analyzing ideal partner profile...`);
      const partnerRecommendations = await this.generatePartnerRecommendations(
        opp,
        teamingAnalysis,
        existingPartners
      );

      // Step 4: Save any new suggested companies to database
      await this.savePartnerRecommendations(partnerRecommendations, opportunityId);

      // Step 5: Post to Slack with Rosa's personality
      console.log(`Connector: Posting to Slack...`);
      const { mainMessage, threadDetail } = this.formatPartnerMessage(opp, teamingAnalysis, partnerRecommendations);
      const { ts: threadTs } = await this.requestDecision(mainMessage);
      await this.reply(threadDetail, threadTs);

      console.log(`Connector: Partner search complete for "${opp.title}"`);
    } catch (error) {
      console.error('Connector: Error finding partners:', error);
      await this.post(`Hit a snag researching partners. Let me try a different angle.`);
    }
  }

  // Analyze teaming needs - should we prime or sub?
  private async analyzeTeamingNeeds(opp: Opportunity): Promise<TeamingAnalysis> {
    const client = getAnthropic();

    // Get agency research if available
    const agencyInfo = opp.agency ? await getAgency(opp.agency) : null;

    const prompt = `You are analyzing teaming strategy for a government contracting opportunity.

OPPORTUNITY:
- Title: ${opp.title}
- Agency: ${opp.agency || 'Unknown'}
- Type: ${opp.type}
- Value: ${opp.est_value || 'Unknown'}
- Description: ${opp.description || 'No description'}

OUR COMPANY (Friends From The City):
- Small business (not 8(a), not SDVOSB, not WOSB currently)
- Specializes in human-centered design, user research, UX, digital services
- Strong at: design research, journey mapping, prototyping, agile delivery
- Gaps: May lack deep technical implementation, no cleared staff, limited agency-specific past performance
${agencyInfo ? `\nAGENCY INTEL:\n- Known pain points: ${agencyInfo.pain_points}\n- Tech stack: ${agencyInfo.tech_stack}` : ''}

Analyze:
1. Should we PRIME (lead) or SUB (support another prime)?
2. What capabilities do we need from partners?
3. What certifications would help (8(a), SDVOSB, WOSB, HUBZone)?
4. What types of companies should we look for?

Respond in JSON:
{
  "should_prime": true/false,
  "prime_reasoning": "<why prime or sub>",
  "capabilities_needed": ["<capability 1>", "<capability 2>"],
  "certifications_needed": ["<cert if any>"],
  "partner_types": ["<type of company to look for>"]
}`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find(block => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No response from Claude');
    }

    try {
      let jsonText = textBlock.text;
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      }
      return JSON.parse(jsonText.trim());
    } catch {
      return {
        should_prime: true,
        prime_reasoning: 'Default to priming for HCD-focused work',
        capabilities_needed: ['technical implementation', 'past performance'],
        certifications_needed: [],
        partner_types: ['small business with agency experience'],
      };
    }
  }

  // Search existing partners in our database
  private async searchExistingPartners(opp: Opportunity): Promise<Company[]> {
    const partners: Company[] = [];

    // Search by NAICS
    if (opp.naics_codes && opp.naics_codes.length > 0) {
      const naicsPartners = await searchCompaniesByNaics(opp.naics_codes);
      partners.push(...naicsPartners);
    }

    // Search by capabilities keywords
    const keywords = opp.keywords_matched || ['digital services', 'user experience', 'agile'];
    const capabilityPartners = await searchCompaniesByCapabilities(keywords);
    partners.push(...capabilityPartners);

    // Dedupe
    const uniquePartners = Array.from(
      new Map(partners.map(p => [p.id, p])).values()
    );

    return uniquePartners;
  }

  // Generate partner recommendations using Claude
  private async generatePartnerRecommendations(
    opp: Opportunity,
    teaming: TeamingAnalysis,
    existingPartners: Company[]
  ): Promise<PartnerRecommendation[]> {
    const client = getAnthropic();

    const existingList = existingPartners.length > 0
      ? existingPartners.map(p =>
        `- ${p.name}: ${p.capabilities || 'Unknown capabilities'}, Certs: ${p.certifications?.join(', ') || 'None'}, Relationship: ${p.relationship_status}`
      ).join('\n')
      : 'No existing partners in database match this opportunity.';

    const prompt = `You are the relationship-focused partner finder for a government BD team.

OPPORTUNITY:
- Title: ${opp.title}
- Agency: ${opp.agency || 'Unknown'}
- Type: ${opp.type}
- Description: ${opp.description || 'No description'}

TEAMING STRATEGY:
- Prime or Sub: ${teaming.should_prime ? 'We should PRIME' : 'Consider SUBBING'}
- Reasoning: ${teaming.prime_reasoning}
- Capabilities needed: ${teaming.capabilities_needed.join(', ')}
- Certifications helpful: ${teaming.certifications_needed.join(', ') || 'None specific'}

EXISTING PARTNERS IN DATABASE:
${existingList}

Recommend 3-5 potential teaming partners. Include:
1. Any relevant existing partners from our database
2. Types of new companies we should pursue (be specific about company profiles)

For each partner, explain:
- Why they're a good fit
- What they bring to the table
- Priority (high/medium/low) based on fit and likelihood

Respond in JSON:
{
  "recommendations": [
    {
      "name": "<company name or profile description for new>",
      "type": "existing" or "suggested",
      "why": "<why this partner>",
      "certifications": ["<relevant certs>"],
      "capabilities": "<what they bring>",
      "relationship": "<known contact, cold outreach, etc>",
      "priority": "high" | "medium" | "low"
    }
  ]
}`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find(block => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No response from Claude');
    }

    try {
      let jsonText = textBlock.text;
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      }
      const parsed = JSON.parse(jsonText.trim());
      return parsed.recommendations || [];
    } catch {
      return [{
        name: 'Partner research needed',
        type: 'suggested',
        why: 'Unable to generate specific recommendations',
        relationship: 'Unknown',
        priority: 'medium',
      }];
    }
  }

  // Save partner recommendations to database
  private async savePartnerRecommendations(
    recommendations: PartnerRecommendation[],
    opportunityId: string
  ): Promise<void> {
    const supabase = getSupabase();

    for (const rec of recommendations) {
      if (rec.type === 'suggested' && !rec.name.toLowerCase().includes('research needed')) {
        // Check if company already exists
        const { data: existing } = await supabase
          .from('companies')
          .select('id')
          .ilike('name', rec.name)
          .limit(1);

        if (!existing || existing.length === 0) {
          // Create new company record
          await createCompany({
            name: rec.name,
            capabilities: rec.capabilities,
            certifications: rec.certifications,
            relationship_status: 'researched',
            relationship_notes: `Identified for opportunity: ${opportunityId}. ${rec.why}`,
            source: 'connector_recommendation',
          });
          console.log(`Connector: Added new partner to database: ${rec.name}`);
        }
      }
    }
  }

  // Format the partner message with Rosa's personality
  // Returns short main message + detailed thread reply
  private formatPartnerMessage(
    opp: Opportunity,
    teaming: TeamingAnalysis,
    recommendations: PartnerRecommendation[]
  ): { mainMessage: string; threadDetail: string } {
    const highPriority = recommendations.filter(r => r.priority === 'high');
    const sortedRecs = [...recommendations].sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.priority] - order[b.priority];
    });

    // SHORT main message (4-6 lines) - Rosa's warm, connected style
    let mainMessage = '';

    if (highPriority.length >= 2) {
      mainMessage = `I was just talking to some folks about *${opp.title}*...\n`;
      mainMessage += `We should *${teaming.should_prime ? 'prime' : 'sub'}* this. I've got ${highPriority.length} strong partner leads.\n\n`;
      mainMessage += `Top pick: *${sortedRecs[0]?.name}* — ${sortedRecs[0]?.why}\n\n`;
    } else if (highPriority.length === 1) {
      mainMessage = `Funny story — I know exactly who we need for *${opp.title}*.\n`;
      mainMessage += `*${sortedRecs[0]?.name}* would be perfect. ${sortedRecs[0]?.why}\n\n`;
    } else {
      mainMessage = `Word on the street about partners for *${opp.title}*...\n`;
      mainMessage += `Options in thread, but nothing's a slam dunk yet.\n\n`;
    }

    mainMessage += `Full list in thread. @Lapedra, want me to draft outreach?`;

    // DETAILED thread reply
    let threadDetail = `*Partner Deep Dive: ${opp.title}*\n\n`;

    // Teaming strategy
    threadDetail += `*Strategy:* ${teaming.should_prime ? 'We prime' : 'Find a prime to sub under'}\n`;
    threadDetail += `${teaming.prime_reasoning}\n\n`;

    // What we need
    if (teaming.capabilities_needed.length > 0) {
      threadDetail += `*Looking for:* ${teaming.capabilities_needed.join(', ')}\n\n`;
    }

    // All partner recommendations
    threadDetail += `*All prospects:*\n\n`;

    for (let i = 0; i < Math.min(sortedRecs.length, 5); i++) {
      const rec = sortedRecs[i];
      const priorityEmoji = rec.priority === 'high' ? '🔥' : rec.priority === 'medium' ? '👍' : '🤔';

      threadDetail += `${priorityEmoji} *${rec.name}*`;
      if (rec.type === 'existing') {
        threadDetail += ` _(in our network)_`;
      }
      threadDetail += `\n`;
      threadDetail += `${rec.why}\n`;
      if (rec.capabilities) {
        threadDetail += `Brings: ${rec.capabilities}\n`;
      }
      if (rec.certifications && rec.certifications.length > 0) {
        threadDetail += `Certs: ${rec.certifications.join(', ')}\n`;
      }
      threadDetail += `Status: ${rec.relationship}\n\n`;
    }

    threadDetail += `_Small world note: a few of these folks were at the ACT-IAC event last month. Good timing._`;

    return { mainMessage, threadDetail };
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
