import { BaseAgent } from './base-agent.js';
import { SCOUT_SYSTEM_PROMPT, SCOUT_RESPONSE_PROMPT } from '../prompts/scout.js';
import { getDailyOpportunities, mapOpportunityType, extractAgencyAbbreviation } from '../integrations/sam-gov.js';
import { createOpportunity, getOpportunityBySamId, getOpportunity } from '../integrations/supabase.js';
import type { AgentName, Opportunity, OpportunityScore } from '../types/index.js';

// Scoring constants from the briefing
const POSITIVE_KEYWORDS = [
  'human-centered design', 'hcd', 'user experience', 'ux',
  'user research', 'service design', 'customer experience',
  'digital services', 'modernization', 'agile', 'prototype',
  'mvp', 'rapid', 'iterative', 'design thinking',
  'web application', 'portal', 'cloud', 'devops',
  'design', 'research', 'usability', 'accessibility',
  'digital transformation', 'innovation', 'journey map',
];

const NEGATIVE_KEYWORDS = [
  'staff augmentation', 'staffing', 'body shop',
  'mainframe', 'cobol', 'legacy maintenance',
  'ts/sci', 'top secret', 'secret clearance',
  'janitorial', 'custodial', 'landscaping', 'construction',
];

const PRIORITY_AGENCIES = ['VA', 'HHS', 'DOL', 'STATE', 'ED', 'SBA', 'GSA'];

const GOOD_TYPES = ['RFI', 'Sources Sought', 'Presolicitation'];

export class ScoutAgent extends BaseAgent {
  name: AgentName = 'scout';
  displayName = 'Scout';
  systemPrompt = SCOUT_SYSTEM_PROMPT;

  async handleAction(action: string, payload: Record<string, unknown>): Promise<void> {
    switch (action) {
      case 'daily_scan':
        await this.runDailyScan();
        break;
      case 'post_opportunity':
        await this.postOpportunity(payload.opportunity_id as string);
        break;
      case 'respond':
        await this.respond(payload.message as string, payload.thread_ts as string | undefined);
        break;
      default:
        console.log(`Scout: Unknown action ${action}`);
    }
  }

  // Post about a specific opportunity with Maya's personality
  async postOpportunity(opportunityId: string): Promise<void> {
    console.log(`Scout: Posting about opportunity ${opportunityId}...`);

    const opp = await getOpportunity(opportunityId);
    if (!opp) {
      console.error(`Scout: Opportunity ${opportunityId} not found`);
      return;
    }

    // Build SHORT main message (4-6 lines) - Maya's quick, punchy style
    let mainMessage = '';

    // Opening based on fit score - Maya's voice
    if (opp.fit_score && opp.fit_score >= 80) {
      mainMessage = `Ooh okay okay, stop what you're doing. *${opp.title}*\n`;
      mainMessage += `${opp.agency || 'Unknown'} · ${opp.type || 'Unknown'} · *${opp.fit_score}/100 fit*`;
      if (opp.due_date) mainMessage += ` · Due ${formatDate(opp.due_date)}`;
      mainMessage += `\n\n`;
      mainMessage += `This reminds me of that ${opp.agency} modernization push back in '22. Same energy. @David, can you dig in?`;
    } else if (opp.fit_score && opp.fit_score >= 60) {
      mainMessage = `Hear me out on this one. *${opp.title}*\n`;
      mainMessage += `${opp.agency || 'Unknown'} · ${opp.type || 'Unknown'} · ${opp.fit_score}/100 fit`;
      if (opp.due_date) mainMessage += ` · Due ${formatDate(opp.due_date)}`;
      mainMessage += `\n\n`;
      mainMessage += `Not a slam dunk but the keywords are there. @David, worth a look?`;
    } else {
      mainMessage = `New one from ${opp.agency || 'Unknown'}. *${opp.title}*\n`;
      mainMessage += `${opp.type || 'Unknown'} · ${opp.fit_score || '?'}/100 fit`;
      if (opp.due_date) mainMessage += ` · Due ${formatDate(opp.due_date)}`;
      mainMessage += `\n\n`;
      mainMessage += `I know, I know, it's a stretch. But hear me out in the thread. @David?`;
    }

    // Post main message and get thread timestamp
    const { ts: threadTs } = await this.postWithMentions(mainMessage, ['analyst']);

    // Post detailed analysis in thread
    let threadDetail = `*The details:*\n\n`;

    if (opp.description) {
      const snippet = opp.description.length > 400
        ? opp.description.substring(0, 400) + '...'
        : opp.description;
      threadDetail += `_"${snippet}"_\n\n`;
    }

    threadDetail += `*Why it caught my eye:*\n`;
    if (opp.fit_reasoning) {
      threadDetail += `${opp.fit_reasoning}\n`;
    }
    if (opp.keywords_matched && opp.keywords_matched.length > 0) {
      threadDetail += `Keywords: ${opp.keywords_matched.join(', ')}\n`;
    }

    if (opp.sam_url) {
      threadDetail += `\n<${opp.sam_url}|View on SAM.gov>`;
    }

    await this.reply(threadDetail, threadTs);
    console.log(`Scout: Posted about "${opp.title}" (main + thread)`);
  }

  // Score an opportunity locally (fast, no API calls)
  private scoreOpportunity(
    title: string,
    description: string,
    agency: string | null,
    type: string,
    dueDate: string | null
  ): OpportunityScore {
    const text = `${title} ${description}`.toLowerCase();
    const breakdown = {
      keywords: 0,
      agency: 0,
      setAside: 0,
      type: 0,
      timeline: 0,
    };
    const keywordsMatched: string[] = [];

    // Keywords scoring (0-30 points)
    for (const keyword of POSITIVE_KEYWORDS) {
      if (text.includes(keyword.toLowerCase())) {
        breakdown.keywords += 5;
        keywordsMatched.push(keyword);
      }
    }
    breakdown.keywords = Math.min(breakdown.keywords, 30);

    // Negative keywords (penalty)
    for (const keyword of NEGATIVE_KEYWORDS) {
      if (text.includes(keyword.toLowerCase())) {
        breakdown.keywords -= 10;
      }
    }
    breakdown.keywords = Math.max(breakdown.keywords, 0);

    // Agency scoring (0-20 points)
    if (agency && PRIORITY_AGENCIES.includes(agency)) {
      breakdown.agency = 20;
    } else if (agency) {
      breakdown.agency = 10; // Known agency, not priority
    }

    // Type scoring (0-15 points)
    if (GOOD_TYPES.some(t => type.includes(t))) {
      breakdown.type = 15; // Lower barrier entry points
    } else if (type.includes('RFP') || type.includes('RFQ')) {
      breakdown.type = 10;
    }

    // Timeline scoring (0-20 points, can go negative)
    if (dueDate) {
      const due = new Date(dueDate);
      const now = new Date();
      const daysUntilDue = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

      if (daysUntilDue < 7) {
        breakdown.timeline = -10; // Too rushed
      } else if (daysUntilDue < 14) {
        breakdown.timeline = 5;
      } else if (daysUntilDue < 45) {
        breakdown.timeline = 20; // Sweet spot
      } else if (daysUntilDue < 90) {
        breakdown.timeline = 15;
      } else {
        breakdown.timeline = 10; // Far out
      }
    } else {
      breakdown.timeline = 10; // No due date, neutral
    }

    const total = Math.max(0, Math.min(100,
      breakdown.keywords + breakdown.agency + breakdown.setAside + breakdown.type + breakdown.timeline
    ));

    // Generate reasoning
    let reasoning = '';
    if (keywordsMatched.length > 0) {
      reasoning = `Matches: ${keywordsMatched.slice(0, 5).join(', ')}. `;
    }
    if (breakdown.agency === 20) {
      reasoning += `Priority agency (${agency}). `;
    }
    if (breakdown.type === 15) {
      reasoning += `Good entry point (${type}). `;
    }
    if (breakdown.timeline < 0) {
      reasoning += `Timeline concern - due soon. `;
    }
    if (!reasoning) {
      reasoning = 'Limited keyword matches. ';
    }

    return {
      total,
      breakdown,
      reasoning: reasoning.trim(),
      keywords_matched: keywordsMatched,
    };
  }

  // Run the daily opportunity scan
  async runDailyScan(): Promise<void> {
    console.log('Scout: Starting daily scan...');
    console.log('Scout: Querying SAM.gov for NAICS 541511, 541512, 541519...');

    try {
      // Fetch opportunities from SAM.gov
      const samOpportunities = await getDailyOpportunities();
      console.log(`Scout: Found ${samOpportunities.length} opportunities from SAM.gov`);

      if (samOpportunities.length === 0) {
        await this.post("Morning team. Quiet night on SAM.gov - nothing new in our NAICS codes. I'll keep watching.");
        return;
      }

      // Process and score each opportunity
      const processedOpps: Array<{ opp: Opportunity; score: OpportunityScore }> = [];
      let skipped = 0;

      for (const samOpp of samOpportunities) {
        // Check if we already have this opportunity
        const existing = await getOpportunityBySamId(samOpp.noticeId);
        if (existing) {
          skipped++;
          continue;
        }

        const agency = extractAgencyAbbreviation(samOpp.department, samOpp.subTier) || samOpp.department || null;
        const type = mapOpportunityType(samOpp.type);

        // Score locally (fast)
        const score = this.scoreOpportunity(
          samOpp.title,
          samOpp.description || '',
          agency,
          type,
          samOpp.responseDeadLine || null
        );

        console.log(`  - "${samOpp.title.substring(0, 50)}..." Score: ${score.total}`);

        // Create opportunity record
        const opp = await createOpportunity({
          sam_id: samOpp.noticeId,
          title: samOpp.title,
          agency,
          office: samOpp.office || null,
          type: type as Opportunity['type'],
          naics_codes: samOpp.naicsCode ? [samOpp.naicsCode] : null,
          posted_date: samOpp.postedDate || null,
          due_date: samOpp.responseDeadLine || null,
          description: samOpp.description || null,
          sam_url: samOpp.uiLink || null,
          fit_score: score.total,
          fit_reasoning: score.reasoning,
          keywords_matched: score.keywords_matched,
          status: 'new',
        });

        processedOpps.push({ opp, score });
      }

      console.log(`Scout: Processed ${processedOpps.length} new, skipped ${skipped} existing`);

      // Sort by score
      processedOpps.sort((a, b) => b.score.total - a.score.total);

      // Generate and post the daily summary
      await this.postDailySummary(processedOpps, samOpportunities.length, skipped);
    } catch (error) {
      console.error('Scout: Error in daily scan:', error);
      await this.post("Morning team. Hit a snag pulling from SAM.gov this morning - I'll retry in a bit.");
    }
  }

  // Post the daily summary to Slack
  private async postDailySummary(
    processedOpps: Array<{ opp: Opportunity; score: OpportunityScore }>,
    totalFromSam: number,
    skipped: number
  ): Promise<void> {
    const newOpps = processedOpps.length;
    const highFit = processedOpps.filter(p => p.score.total >= 70);
    const mediumFit = processedOpps.filter(p => p.score.total >= 50 && p.score.total < 70);
    const lowFit = processedOpps.filter(p => p.score.total < 50);

    // Generate the summary message with Scout's personality
    let message = '';

    if (newOpps === 0 && skipped > 0) {
      message = `Morning team. ${totalFromSam} in our NAICS codes overnight, but all ${skipped} were ones we've already seen. Nothing new to report.`;
    } else if (newOpps === 0) {
      message = `Morning team. Quiet night on SAM.gov - nothing new in our NAICS codes. I'll keep watching.`;
    } else {
      // Opening line with Scout's personality
      if (highFit.length >= 3) {
        message = `Morning team. Okay, this is a good haul - ${totalFromSam} posted overnight, ${newOpps} worth tracking.\n\n`;
      } else if (highFit.length > 0) {
        message = `Morning team. ${totalFromSam} posted overnight, ${newOpps} new to track.\n\n`;
      } else {
        message = `Morning team. ${totalFromSam} posted overnight. Slim pickings, but here's what I found.\n\n`;
      }

      // High fit opportunities (detailed)
      if (highFit.length > 0) {
        message += `*Worth discussing (${highFit.length}):*\n\n`;

        for (const { opp, score } of highFit.slice(0, 5)) { // Max 5 detailed
          message += `*${opp.title}*\n`;
          message += `${opp.type || 'Unknown'} · ${opp.agency || 'Unknown Agency'}`;
          if (opp.due_date) {
            message += ` · Due ${formatDate(opp.due_date)}`;
          }
          message += `\nFit: ${score.total}/100\n`;
          message += `${score.reasoning}\n`;
          if (opp.sam_url) {
            message += `<${opp.sam_url}|View on SAM.gov>\n`;
          }
          message += `\n`;
        }

        if (highFit.length > 5) {
          message += `_...and ${highFit.length - 5} more high-fit opportunities_\n\n`;
        }

        message += `@Analyst - mind taking a look at ${highFit.length === 1 ? 'this one' : 'these'}?\n`;
      }

      // Medium fit (summary only)
      if (mediumFit.length > 0 && highFit.length === 0) {
        message += `*Medium fit (${mediumFit.length}):*\n`;
        message += `Nothing that made me spill my coffee, but some possibilities if we're looking for volume.\n\n`;

        for (const { opp, score } of mediumFit.slice(0, 3)) {
          message += `• ${opp.title} (${score.total}/100)\n`;
        }
        if (mediumFit.length > 3) {
          message += `• _...and ${mediumFit.length - 3} more_\n`;
        }
        message += `\n`;
      } else if (mediumFit.length > 0) {
        message += `\n_Also: ${mediumFit.length} medium-fit opportunities in the database if anyone wants to dig._\n`;
      }

      // Low fit acknowledgment
      if (lowFit.length > 0 && highFit.length === 0 && mediumFit.length === 0) {
        message += `Found ${lowFit.length} opportunities but nothing scored above 50. Keywords weren't there. I'll keep watching.`;
      }
    }

    // Post the summary
    const mentions: AgentName[] = highFit.length > 0 ? ['analyst'] : [];
    if (mentions.length > 0) {
      await this.postWithMentions(message, mentions);
    } else {
      await this.post(message);
    }

    console.log(`Scout: Posted summary to Slack (${highFit.length} high, ${mediumFit.length} medium, ${lowFit.length} low)`);
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
