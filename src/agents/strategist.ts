import { BaseAgent } from './base-agent.js';
import { STRATEGIST_SYSTEM_PROMPT, STRATEGIST_RESPONSE_PROMPT } from '../prompts/strategist.js';
import {
  getOpportunity,
  updateOpportunity,
  getActiveOpportunities,
  getOutreachByOpportunity,
  getAgency,
  getSupabase,
} from '../integrations/supabase.js';
import { getAnthropic } from '../integrations/claude.js';
import type { AgentName, Opportunity, Company, Agency } from '../types/index.js';

interface CaptureAssessment {
  win_probability: 'high' | 'medium' | 'low';
  win_reasoning: string;
  recommended_approach: 'prime' | 'sub' | 'no_bid';
  approach_reasoning: string;
  differentiators: string[];
  risks: string[];
  recommendation: 'go' | 'no_go' | 'hold';
  recommendation_reasoning: string;
  investment_hours: string;
  next_steps: string[];
}

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

  // Main synthesis and decision request
  async synthesizeOpportunity(opportunityId: string): Promise<void> {
    console.log(`Strategist: Synthesizing opportunity ${opportunityId}...`);

    try {
      // Step 1: Get opportunity data (includes Scout's analysis)
      const opp = await getOpportunity(opportunityId);
      if (!opp) {
        console.error(`Strategist: Opportunity ${opportunityId} not found`);
        return;
      }

      console.log(`Strategist: Found "${opp.title}"`);

      // Step 2: Get Analyst's agency research
      console.log(`Strategist: Gathering Analyst's research...`);
      const agencyResearch = opp.agency ? await getAgency(opp.agency) : null;

      // Step 3: Get Connector's partner recommendations
      console.log(`Strategist: Gathering Connector's partner recommendations...`);
      const partners = await this.getPartnerRecommendations(opportunityId);

      // Step 4: Get any outreach status
      const outreach = await getOutreachByOpportunity(opportunityId);

      // Step 5: Generate capture assessment using Claude
      console.log(`Strategist: Running capture assessment...`);
      const assessment = await this.generateCaptureAssessment(opp, agencyResearch, partners);

      // Step 6: Format and post decision request
      console.log(`Strategist: Posting to Slack...`);
      const { mainMessage, threadDetail } = this.formatDecisionRequest(
        opp,
        agencyResearch,
        partners,
        assessment,
        outreach.length
      );
      const { ts: threadTs } = await this.requestDecision(mainMessage);
      await this.reply(threadDetail, threadTs);

      // Update opportunity status if needed
      if (opp.status === 'new') {
        await updateOpportunity(opportunityId, { status: 'researching' });
      }

      console.log(`Strategist: Synthesis complete for "${opp.title}"`);
    } catch (error) {
      console.error('Strategist: Error synthesizing opportunity:', error);
      await this.post(`Need to circle back on that synthesis. Hit a snag.`);
    }
  }

  // Get partner recommendations for this opportunity
  private async getPartnerRecommendations(opportunityId: string): Promise<Company[]> {
    const supabase = getSupabase();

    // Get companies that were identified for this opportunity
    const { data: partners } = await supabase
      .from('companies')
      .select('*')
      .ilike('relationship_notes', `%${opportunityId}%`)
      .limit(10);

    // Also get any companies with recent research status
    const { data: recentPartners } = await supabase
      .from('companies')
      .select('*')
      .eq('relationship_status', 'researched')
      .eq('source', 'connector_recommendation')
      .order('created_at', { ascending: false })
      .limit(5);

    // Combine and dedupe
    const allPartners = [...(partners || []), ...(recentPartners || [])];
    const uniquePartners = Array.from(new Map(allPartners.map((p) => [p.id, p])).values());

    return uniquePartners;
  }

  // Generate capture assessment using Claude
  private async generateCaptureAssessment(
    opp: Opportunity,
    agency: Agency | null,
    partners: Company[]
  ): Promise<CaptureAssessment> {
    const client = getAnthropic();

    const partnerList =
      partners.length > 0
        ? partners
            .map(
              (p) =>
                `- ${p.name}: ${p.capabilities || 'Unknown'}, Certs: ${p.certifications?.join(', ') || 'None'}`
            )
            .join('\n')
        : 'No partners identified yet';

    const prompt = `You are the capture strategist synthesizing a pursuit decision.

OPPORTUNITY:
- Title: ${opp.title}
- Agency: ${opp.agency || 'Unknown'}
- Type: ${opp.type}
- Value: ${opp.est_value || 'Unknown'}
- Due Date: ${opp.due_date || 'Not specified'}
- Status: ${opp.status}

DESCRIPTION:
${opp.description || 'No description'}

SCOUT'S ASSESSMENT (Initial Fit):
- Fit Score: ${opp.fit_score}/100
- Reasoning: ${opp.fit_reasoning}
- Keywords Matched: ${opp.keywords_matched?.join(', ') || 'None'}

ANALYST'S RESEARCH (Agency Intel):
${
  agency
    ? `
- Tech Stack: ${agency.tech_stack || 'Unknown'}
- Pain Points: ${agency.pain_points || 'Unknown'}
- Notes: ${agency.research_notes || 'None'}
`
    : 'No agency research available'
}

CONNECTOR'S PARTNER OPTIONS:
${partnerList}

OUR COMPANY (Friends From The City):
- Small business HCD/UX/digital services firm
- Strong at: human-centered design, user research, journey mapping, rapid prototyping
- Gaps: Limited federal past performance, no clearances, small team
- No current ${opp.agency || 'agency'} past performance

Synthesize all inputs and provide a capture assessment:

1. WIN PROBABILITY: Based on our fit, competition, and gaps
2. RECOMMENDED APPROACH: Prime, Sub, or No Bid
3. DIFFERENTIATORS: What makes us competitive
4. RISKS: What could go wrong
5. RECOMMENDATION: GO, NO-GO, or HOLD (need more info)

Be decisive. This is a business decision - balance optimism with realism.

Respond in JSON:
{
  "win_probability": "high" | "medium" | "low",
  "win_reasoning": "<why this probability>",
  "recommended_approach": "prime" | "sub" | "no_bid",
  "approach_reasoning": "<why this approach>",
  "differentiators": ["<differentiator 1>", "<differentiator 2>"],
  "risks": ["<risk 1>", "<risk 2>"],
  "recommendation": "go" | "no_go" | "hold",
  "recommendation_reasoning": "<crisp 2-3 sentence rationale>",
  "investment_hours": "<estimated hours range>",
  "next_steps": ["<step 1 if GO>", "<step 2>"]
}`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
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
        win_probability: 'medium',
        win_reasoning: 'Unable to fully assess',
        recommended_approach: 'prime',
        approach_reasoning: 'Default recommendation',
        differentiators: ['HCD expertise'],
        risks: ['Assessment incomplete'],
        recommendation: 'hold',
        recommendation_reasoning: 'Need manual review - automated assessment failed.',
        investment_hours: '40-60',
        next_steps: ['Manual review required'],
      };
    }
  }

  // Format the decision request with James's personality
  // Returns short main message + detailed thread reply
  private formatDecisionRequest(
    opp: Opportunity,
    agency: Agency | null,
    partners: Company[],
    assessment: CaptureAssessment,
    outreachCount: number
  ): { mainMessage: string; threadDetail: string } {
    const recEmoji =
      assessment.recommendation === 'go'
        ? '✅'
        : assessment.recommendation === 'no_go'
          ? '❌'
          : '⏸️';
    const probEmoji =
      assessment.win_probability === 'high'
        ? '🟢'
        : assessment.win_probability === 'medium'
          ? '🟡'
          : '🔴';

    // SHORT main message (4-6 lines) - James's decisive voice
    let mainMessage: string;

    if (assessment.recommendation === 'go' && assessment.win_probability === 'high') {
      mainMessage = `Here's how I see it. *${opp.title}*\n\n`;
      mainMessage += `${recEmoji} *GO* — ${probEmoji} ${assessment.win_probability} pwin. ${assessment.recommendation_reasoning}\n\n`;
      mainMessage += `Bottom line: ~${assessment.investment_hours} hours to win this. Full analysis in thread.\n`;
    } else if (assessment.recommendation === 'go') {
      mainMessage = `Alright, I've looked at everything. *${opp.title}*\n\n`;
      mainMessage += `${recEmoji} *GO* — ${probEmoji} ${assessment.win_probability} pwin. Worth the shot.\n`;
      mainMessage += `${assessment.recommendation_reasoning}\n\n`;
      mainMessage += `Details in thread.`;
    } else if (assessment.recommendation === 'no_go') {
      mainMessage = `Let's be real about *${opp.title}*.\n\n`;
      mainMessage += `${recEmoji} *NO-GO* — ${assessment.recommendation_reasoning}\n\n`;
      mainMessage += `I've seen this play out before. Don't make the same mistake I made on that DOL thing in '19. Details in thread.`;
    } else {
      mainMessage = `Team's done the work on *${opp.title}*. Here's where we are.\n\n`;
      mainMessage += `${recEmoji} *HOLD* — Need more info before I can make the call.\n`;
      mainMessage += `${assessment.recommendation_reasoning}`;
    }

    mainMessage += `\n\n@Lapedra — *GO* or *PASS*?`;

    // DETAILED thread reply
    let threadDetail = `*Full Capture Assessment: ${opp.title}*\n`;
    threadDetail += `${opp.type} · ${opp.agency || 'Unknown'} · ${opp.est_value || 'Value TBD'} · Due ${opp.due_date || 'TBD'}\n\n`;

    // Team summary
    threadDetail += `*Team findings:*\n`;
    threadDetail += `• Maya's fit score: ${opp.fit_score}/100\n`;
    if (agency) {
      threadDetail += `• David researched ${opp.agency}: ${agency.pain_points ? 'Pain points identified' : 'Limited intel'}\n`;
    }
    threadDetail += `• Rosa found ${partners.length} potential partners\n`;
    if (outreachCount > 0) {
      threadDetail += `• ${outreachCount} outreach drafts ready\n`;
    }
    threadDetail += `\n`;

    // Win probability reasoning
    threadDetail += `*Win Probability:* ${probEmoji} ${assessment.win_probability.toUpperCase()}\n`;
    threadDetail += `${assessment.win_reasoning}\n\n`;

    // Approach
    threadDetail += `*Approach:* `;
    if (assessment.recommended_approach === 'prime') {
      threadDetail += `PRIME — Lead this pursuit\n`;
    } else if (assessment.recommended_approach === 'sub') {
      threadDetail += `SUB — Partner with a prime\n`;
    } else {
      threadDetail += `NO BID\n`;
    }
    threadDetail += `${assessment.approach_reasoning}\n\n`;

    // Differentiators
    if (assessment.differentiators.length > 0) {
      threadDetail += `*Our differentiators:* ${assessment.differentiators.join(' · ')}\n\n`;
    }

    // Risks
    if (assessment.risks.length > 0) {
      threadDetail += `*Risks:*\n`;
      for (const risk of assessment.risks) {
        threadDetail += `• ${risk}\n`;
      }
      threadDetail += `\n`;
    }

    // Next steps
    if (assessment.recommendation === 'go' && assessment.next_steps.length > 0) {
      threadDetail += `*If GO:*\n`;
      for (const step of assessment.next_steps) {
        threadDetail += `• ${step}\n`;
      }
    }

    threadDetail += `\n_We had something like this at my old shop. Similar agency, similar scope. We won that one. Same playbook could work here._`;

    return { mainMessage, threadDetail };
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
      const pursuing = activeOpps.filter((o) => o.status === 'pursuing');
      const researching = activeOpps.filter((o) => o.status === 'researching');
      const newOpps = activeOpps.filter((o) => o.status === 'new');

      // Build standup message
      let message = `*Morning Standup*\n\n`;

      if (pursuing.length > 0) {
        message += `*Active Pursuits (${pursuing.length}):*\n`;
        for (const opp of pursuing) {
          const outreach = await getOutreachByOpportunity(opp.id);
          message += `• ${opp.title} (${opp.agency || 'Unknown'})`;
          message += ` - Due ${opp.due_date || 'TBD'}`;
          if (outreach.length > 0) {
            const sent = outreach.filter((o) => o.email_sent).length;
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
      const pendingDecisions = activeOpps.filter((o) => o.decision === 'pending');
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
        const nearDeadline = pursuing.filter((o) => {
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
      await this.post(
        `Morning team. Standup report hit a glitch - checking the pipeline manually.`
      );
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

// Export singleton instance
export const strategist = new StrategistAgent();
