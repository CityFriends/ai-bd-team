import { BaseAgent } from './base-agent.js';
import { PM_SYSTEM_PROMPT, PM_RESPONSE_PROMPT } from '../prompts/pm.js';
import {
  getActiveOpportunities,
  getOutreachByOpportunity,
  getSupabase,
} from '../integrations/supabase.js';
import type { AgentName, Opportunity } from '../types/index.js';

interface PipelineItem {
  opportunity: Opportunity;
  daysUntilDue: number | null;
  daysSinceCreated: number;
  outreachCount: number;
  needsDecision: boolean;
}

export class PMAgent extends BaseAgent {
  name: AgentName = 'pm';
  displayName = 'PM';
  systemPrompt = PM_SYSTEM_PROMPT;

  async handleAction(action: string, payload: Record<string, unknown>): Promise<void> {
    switch (action) {
      case 'morning_standup':
        await this.runMorningStandup();
        break;
      case 'check_pending_decisions':
        await this.checkPendingDecisions();
        break;
      case 'nudge':
        await this.nudge(
          payload.target as string,
          payload.topic as string,
          payload.thread_ts as string | undefined
        );
        break;
      case 'respond':
        await this.respond(payload.message as string, payload.thread_ts as string | undefined);
        break;
      default:
        console.log(`PM: Unknown action ${action}`);
    }
  }

  // Run the morning standup
  async runMorningStandup(): Promise<void> {
    console.log('PM: Running morning standup...');

    try {
      const pipeline = await this.getPipelineStatus();
      const { mainMessage, threadDetail } = this.formatStandupMessage(pipeline);

      // Post standup
      const { ts: threadTs } = await this.post(mainMessage);
      if (threadDetail) {
        await this.reply(threadDetail, threadTs);
      }

      console.log('PM: Standup complete');
    } catch (error) {
      console.error('PM: Error running standup:', error);
      await this.post(
        `Morning all. Hit a snag pulling the pipeline status - give me a sec to sort this out.`
      );
    }
  }

  // Get current pipeline status
  private async getPipelineStatus(): Promise<PipelineItem[]> {
    const opportunities = await getActiveOpportunities();
    const pipeline: PipelineItem[] = [];

    for (const opp of opportunities) {
      const outreach = await getOutreachByOpportunity(opp.id);

      let daysUntilDue: number | null = null;
      if (opp.due_date) {
        const due = new Date(opp.due_date);
        daysUntilDue = Math.ceil((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      }

      const created = new Date(opp.created_at);
      const daysSinceCreated = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));

      pipeline.push({
        opportunity: opp,
        daysUntilDue,
        daysSinceCreated,
        outreachCount: outreach.length,
        needsDecision: opp.decision === 'pending',
      });
    }

    // Sort by urgency (due date, then pending decisions, then age)
    pipeline.sort((a, b) => {
      // Pending decisions first
      if (a.needsDecision && !b.needsDecision) return -1;
      if (!a.needsDecision && b.needsDecision) return 1;

      // Then by due date
      if (a.daysUntilDue !== null && b.daysUntilDue !== null) {
        return a.daysUntilDue - b.daysUntilDue;
      }
      if (a.daysUntilDue !== null) return -1;
      if (b.daysUntilDue !== null) return 1;

      // Then by age
      return b.daysSinceCreated - a.daysSinceCreated;
    });

    return pipeline;
  }

  // Format the standup message - Patricia's style
  private formatStandupMessage(pipeline: PipelineItem[]): {
    mainMessage: string;
    threadDetail: string | null;
  } {
    const pendingDecisions = pipeline.filter((p) => p.needsDecision);
    const urgentDeadlines = pipeline.filter((p) => p.daysUntilDue !== null && p.daysUntilDue <= 14);
    const pursuing = pipeline.filter((p) => p.opportunity.status === 'pursuing');
    const researching = pipeline.filter((p) => p.opportunity.status === 'researching');
    const newOpps = pipeline.filter((p) => p.opportunity.status === 'new');

    // SHORT main message - Patricia's checklist style
    let mainMessage = `Morning all, here's where we are.\n\n`;

    // Decisions needed (most important)
    if (pendingDecisions.length > 0) {
      mainMessage += `⏰ *${pendingDecisions.length} decision${pendingDecisions.length > 1 ? 's' : ''} waiting on @Lapedra*\n`;
      for (const item of pendingDecisions.slice(0, 2)) {
        mainMessage += `• ${item.opportunity.title} (${item.daysSinceCreated}d old)\n`;
      }
      if (pendingDecisions.length > 2) {
        mainMessage += `• _+${pendingDecisions.length - 2} more in thread_\n`;
      }
      mainMessage += `\n`;
    }

    // Quick pipeline summary
    mainMessage += `*Pipeline:* ${pursuing.length} pursuing · ${researching.length} researching · ${newOpps.length} new\n`;

    // Urgent deadlines
    if (urgentDeadlines.length > 0) {
      mainMessage += `\n⏰ *Deadlines in 2 weeks:* `;
      mainMessage += urgentDeadlines
        .map((u) => `${u.opportunity.agency} (${u.daysUntilDue}d)`)
        .join(', ');
      mainMessage += `\n`;
    }

    // Today's priorities
    mainMessage += `\n*Today:*\n`;
    if (newOpps.length > 0) {
      mainMessage += `• Maya: ${newOpps.length} new to triage\n`;
    }
    if (researching.length > 0) {
      mainMessage += `• David: ${researching.length} awaiting research\n`;
    }
    if (pendingDecisions.length > 0) {
      mainMessage += `• @Lapedra: Can we get eyes on ${pendingDecisions.length === 1 ? 'this decision' : 'these decisions'}?\n`;
    }
    if (pipeline.length === 0) {
      mainMessage += `• Pipeline's empty - Maya, anything overnight?\n`;
    }

    // Thread detail if there's more to say
    let threadDetail: string | null = null;

    if (pipeline.length > 0) {
      threadDetail = `*Full Pipeline Status*\n\n`;

      if (pendingDecisions.length > 0) {
        threadDetail += `*Decisions Needed:*\n`;
        for (const item of pendingDecisions) {
          threadDetail += `• ${item.opportunity.title} (${item.opportunity.agency})\n`;
          threadDetail += `  Status: ${item.opportunity.status} · Fit: ${item.opportunity.fit_score}/100\n`;
          threadDetail += `  Waiting: ${item.daysSinceCreated} days`;
          if (item.daysUntilDue !== null) {
            threadDetail += ` · Due in ${item.daysUntilDue} days`;
          }
          threadDetail += `\n\n`;
        }
      }

      if (pursuing.length > 0) {
        threadDetail += `*Active Pursuits:*\n`;
        for (const item of pursuing) {
          threadDetail += `• ${item.opportunity.title}`;
          if (item.daysUntilDue !== null) {
            const emoji = item.daysUntilDue <= 7 ? '🔴' : item.daysUntilDue <= 14 ? '🟡' : '🟢';
            threadDetail += ` ${emoji} ${item.daysUntilDue}d until due`;
          }
          if (item.outreachCount > 0) {
            threadDetail += ` · ${item.outreachCount} outreach`;
          }
          threadDetail += `\n`;
        }
        threadDetail += `\n`;
      }

      if (researching.length > 0) {
        threadDetail += `*In Research:*\n`;
        for (const item of researching) {
          threadDetail += `• ${item.opportunity.title} (${item.daysSinceCreated}d in pipeline)\n`;
        }
        threadDetail += `\n`;
      }

      threadDetail += `_Adding this to my list. I'll check back this afternoon._`;
    }

    return { mainMessage, threadDetail };
  }

  // Check and remind about pending decisions
  async checkPendingDecisions(): Promise<void> {
    console.log('PM: Checking pending decisions...');

    const supabase = getSupabase();
    const { data: pending } = await supabase
      .from('opportunities')
      .select('*')
      .eq('decision', 'pending')
      .order('created_at', { ascending: true });

    if (!pending || pending.length === 0) {
      console.log('PM: No pending decisions');
      return;
    }

    // Group by age
    const old = pending.filter((p) => {
      const created = new Date(p.created_at);
      const days = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
      return days >= 2;
    });

    if (old.length === 0) {
      console.log('PM: No old pending decisions to remind about');
      return;
    }

    // Post reminder
    let message = `Just wanted to bubble this up, @Lapedra.\n\n`;
    message += `*${old.length} decision${old.length > 1 ? 's' : ''} waiting:*\n`;

    for (const opp of old) {
      const created = new Date(opp.created_at);
      const days = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
      message += `• ${opp.title} — ${days} days\n`;
    }

    message += `\nI know you're busy, but can we get eyes on ${old.length === 1 ? 'this' : 'these'}?`;

    await this.requestDecision(message);
    console.log(`PM: Reminded about ${old.length} pending decisions`);
  }

  // Nudge someone about something
  async nudge(target: string, topic: string, threadTs?: string): Promise<void> {
    console.log(`PM: Nudging ${target} about ${topic}...`);

    let message = `Gentle nudge on this one, @${target}.\n\n`;
    message += `${topic}\n\n`;
    message += `Who's got the ball on this? Just want to make sure it doesn't slip.`;

    if (threadTs) {
      await this.reply(message, threadTs);
    } else {
      await this.post(message);
    }
  }

  // Respond to a message
  async respond(message: string, threadTs?: string): Promise<void> {
    const response = await this.generateResponse(
      PM_RESPONSE_PROMPT + '\n\nMessage to respond to: ' + message
    );

    if (threadTs) {
      await this.reply(response, threadTs);
    } else {
      await this.post(response);
    }
  }
}

// Export singleton instance
export const pm = new PMAgent();
