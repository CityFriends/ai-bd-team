import { BaseAgent } from './base-agent.js';
import { ANALYST_SYSTEM_PROMPT, ANALYST_RESPONSE_PROMPT } from '../prompts/analyst.js';
import { getOpportunity, updateOpportunity, getAgency, upsertAgency } from '../integrations/supabase.js';
import { getAnthropic } from '../integrations/claude.js';
import type { AgentName, Opportunity } from '../types/index.js';

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

      console.log(`Analyst: Found "${opp.title}"`);

      // Update status to researching
      await updateOpportunity(opportunityId, { status: 'researching' });

      // Step 1: Research the agency
      console.log(`Analyst: Researching agency ${opp.agency}...`);
      const agencyResearch = await this.researchAgencyDeep(opp.agency || 'Unknown');

      // Save agency research
      if (opp.agency) {
        await upsertAgency({
          name: opp.agency,
          abbreviation: opp.agency,
          tech_stack: agencyResearch.tech_stack,
          pain_points: agencyResearch.pain_points,
          research_notes: agencyResearch.notes,
          last_researched: new Date().toISOString(),
        });
        console.log(`Analyst: Saved agency research for ${opp.agency}`);
      }

      // Step 2: Deep analysis of the opportunity
      console.log(`Analyst: Analyzing opportunity...`);
      const analysis = await this.analyzeOpportunityDeep(opp, agencyResearch);

      // Step 3: Generate Slack message with David's personality
      console.log(`Analyst: Generating report...`);
      const { mainMessage, threadDetail } = this.formatAnalysisMessage(opp, agencyResearch, analysis);

      // Post main message to Slack, then details in thread
      console.log(`Analyst: Posting to Slack...`);
      const { ts: threadTs } = await this.postWithMentions(mainMessage, ['connector']);
      await this.reply(threadDetail, threadTs);

      console.log(`Analyst: Research complete for "${opp.title}"`);
    } catch (error) {
      console.error('Analyst: Error researching opportunity:', error);
      await this.post(`Hit a wall researching that opportunity. Will circle back.`);
    }
  }

  // Deep agency research using Claude
  private async researchAgencyDeep(agency: string): Promise<{
    tech_stack: string;
    pain_points: string;
    notes: string;
    incumbent_landscape: string;
    recent_initiatives: string;
  }> {
    const client = getAnthropic();

    // Check if we have existing research
    const existingAgency = await getAgency(agency);
    const existingContext = existingAgency?.research_notes
      ? `\nExisting notes: ${existingAgency.research_notes}`
      : '';

    const prompt = `You are researching the ${agency} (${this.expandAgencyName(agency)}) for a government contracting opportunity.

Provide intelligence on:
1. Tech Stack: What technologies, platforms, and systems do they commonly use?
2. Pain Points: What are their known challenges, especially around digital services and user experience?
3. Incumbent Landscape: Who are the typical contractors that win work here? Is work usually wired to incumbents?
4. Recent Initiatives: Any known modernization efforts, digital transformation projects, or relevant programs?
5. Notes: Any other relevant BD intelligence
${existingContext}

Be specific and realistic. If you don't know something, say so rather than making it up.

Respond in JSON format:
{
  "tech_stack": "<technologies they use>",
  "pain_points": "<known challenges>",
  "incumbent_landscape": "<who wins work here, is it wired?>",
  "recent_initiatives": "<relevant programs or initiatives>",
  "notes": "<other BD intelligence>"
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
        tech_stack: 'Unknown',
        pain_points: 'Unknown',
        incumbent_landscape: 'Unknown',
        recent_initiatives: 'Unknown',
        notes: textBlock.text,
      };
    }
  }

  // Deep opportunity analysis
  private async analyzeOpportunityDeep(
    opp: Opportunity,
    agencyResearch: { incumbent_landscape: string; recent_initiatives: string }
  ): Promise<{
    pros: string[];
    cons: string[];
    red_flags: string[];
    recommendation: 'pursue' | 'pass' | 'maybe';
    confidence: 'high' | 'medium' | 'low';
    reasoning: string;
  }> {
    const client = getAnthropic();

    const prompt = `You are a skeptical but fair BD analyst evaluating this government contracting opportunity.

OPPORTUNITY:
- Title: ${opp.title}
- Agency: ${opp.agency || 'Unknown'}
- Office: ${opp.office || 'Unknown'}
- Type: ${opp.type}
- Value: ${opp.est_value || 'Unknown'}
- Due Date: ${opp.due_date || 'Not specified'}
- NAICS: ${opp.naics_codes?.join(', ') || 'Unknown'}

DESCRIPTION:
${opp.description || 'No description provided'}

SCOUT'S ASSESSMENT:
- Fit Score: ${opp.fit_score}/100
- Reasoning: ${opp.fit_reasoning}
- Keywords Matched: ${opp.keywords_matched?.join(', ') || 'None'}

AGENCY INTELLIGENCE:
- Incumbent Landscape: ${agencyResearch.incumbent_landscape}
- Recent Initiatives: ${agencyResearch.recent_initiatives}

OUR COMPANY (Friends From The City):
- Specializes in human-centered design, user research, and digital services
- Small business
- No current VA past performance (relevant if this is VA)

Analyze this opportunity thoroughly. Be skeptical - protect the team from bad bets. Consider:
1. Is this actually in our wheelhouse or is Scout being optimistic?
2. Is this likely wired to an incumbent?
3. Can we realistically compete and win?
4. Is the timeline reasonable?
5. Are there any red flags in the language or requirements?

Respond in JSON:
{
  "pros": ["<pro 1>", "<pro 2>", ...],
  "cons": ["<con 1>", "<con 2>", ...],
  "red_flags": ["<red flag if any>"],
  "recommendation": "pursue" | "pass" | "maybe",
  "confidence": "high" | "medium" | "low",
  "reasoning": "<2-3 sentence summary of your recommendation>"
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
        pros: ['Unable to fully analyze'],
        cons: ['Analysis failed'],
        red_flags: [],
        recommendation: 'maybe',
        confidence: 'low',
        reasoning: 'Analysis encountered an error. Manual review recommended.',
      };
    }
  }

  // Format the analysis as a Slack message with David's personality
  // Returns short main message + detailed thread reply
  private formatAnalysisMessage(
    opp: Opportunity,
    agencyResearch: { tech_stack: string; pain_points: string; incumbent_landscape: string },
    analysis: {
      pros: string[];
      cons: string[];
      red_flags: string[];
      recommendation: string;
      confidence: string;
      reasoning: string;
    }
  ): { mainMessage: string; threadDetail: string } {
    // SHORT main message (4-6 lines) - David's measured voice
    let mainMessage = '';
    const recEmoji = analysis.recommendation === 'pursue' ? '👍' : analysis.recommendation === 'pass' ? '👎' : '🤷';

    if (analysis.recommendation === 'pass') {
      mainMessage = `Here's the thing about *${opp.title}*...\n`;
      mainMessage += `${recEmoji} *PASS* — ${analysis.reasoning}\n\n`;
      mainMessage += `I've seen this movie before. Details in thread. @Rosa, hold off on partners for now.`;
    } else if (analysis.recommendation === 'pursue' && analysis.confidence === 'high') {
      mainMessage = `To be fair to Maya, she found a good one. *${opp.title}*\n`;
      mainMessage += `${recEmoji} *PURSUE* — ${analysis.reasoning}\n\n`;
      mainMessage += `Full analysis in thread. @Rosa, start thinking partners.`;
    } else {
      mainMessage = `Did my homework on *${opp.title}*.\n`;
      mainMessage += `${recEmoji} *${analysis.recommendation.toUpperCase()}* — ${analysis.reasoning}\n\n`;
      mainMessage += `Details in thread. @Rosa, your thoughts on teaming?`;
    }

    // DETAILED thread reply
    let threadDetail = `*Full Analysis: ${opp.title}*\n\n`;

    // Agency Intel
    threadDetail += `*Agency Intel (${opp.agency}):*\n`;
    threadDetail += `Tech: ${agencyResearch.tech_stack}\n`;
    threadDetail += `Pain points: ${agencyResearch.pain_points}\n`;
    threadDetail += `Incumbents: ${agencyResearch.incumbent_landscape}\n\n`;

    // Pros
    if (analysis.pros.length > 0) {
      threadDetail += `*What's working for us:*\n`;
      for (const pro of analysis.pros) {
        threadDetail += `• ${pro}\n`;
      }
      threadDetail += `\n`;
    }

    // Cons
    if (analysis.cons.length > 0) {
      threadDetail += `*Concerns:*\n`;
      for (const con of analysis.cons) {
        threadDetail += `• ${con}\n`;
      }
      threadDetail += `\n`;
    }

    // Red flags
    if (analysis.red_flags.length > 0) {
      threadDetail += `*Red Flags:*\n`;
      for (const flag of analysis.red_flags) {
        threadDetail += `• ${flag}\n`;
      }
      threadDetail += `\n`;
    }

    threadDetail += `_The GAO would have a field day with this procurement structure, but that's a different conversation._`;

    return { mainMessage, threadDetail };
  }

  // Helper to expand agency abbreviations
  private expandAgencyName(abbrev: string): string {
    const names: Record<string, string> = {
      VA: 'Department of Veterans Affairs',
      HHS: 'Health and Human Services',
      DOL: 'Department of Labor',
      STATE: 'Department of State',
      ED: 'Department of Education',
      SBA: 'Small Business Administration',
      GSA: 'General Services Administration',
      DOD: 'Department of Defense',
      DHS: 'Department of Homeland Security',
    };
    return names[abbrev] || abbrev;
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
