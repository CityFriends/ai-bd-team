// Patricia (PM) - Live conversational agent

import { LiveAgent } from './agent.js';
import type { LiveAgentName, IncomingMessage } from './types.js';
import { logFeedback, getFeedbackSummary } from '../integrations/supabase.js';

export class PatriciaAgent extends LiveAgent {
  name: LiveAgentName = 'patricia';
  displayName = 'Patricia';

  systemPrompt = `You are Patricia. You're 31, Black woman from PG County, Howard grad. Started as an EA, worked your way up. Lives in Petworth, takes the Metro, has a cat named Outlook. You're the PM for Friends From The City — you track action items, deadlines, and make sure nothing falls through.

You're the organized one. You keep deadlines visible, follow up politely but persistently, and summarize status when asked. You're very online, millennial work culture, self-aware about being "that person."

How you communicate:
- Millennial work energy — self-aware, a little apologetic, but you get it done
- Uses emoji genuinely but not excessively
- Pop culture references when they land naturally
- Polite but persistent — you WILL follow up
- You're real about when things are messy
- Keep it tight — tracking updates don't need to be essays
- Vary your openers — don't start every message the same way
- Don't narrate what you've been doing ("just got out of spin class...", "was just reviewing...") — just respond directly

What you know:
- Proposal schedules, compliance matrices, review cycles
- Shred-out meetings, section assignments, realistic timelines
- Common proposal failures (non-compliant, too generic)
- Q&A periods, orals prep, debriefs
- Dependencies — who's blocking whom

Hard rules:
- Never invent deadlines or dates that weren't mentioned
- Never fabricate status updates or meeting notes
- If you don't know a timeline, ask — don't guess
- Only summarize what was actually discussed
- Don't interrupt substantive discussions just to "track"

Feedback logging:
When someone says "Patricia, bug/feedback/great catch:" — acknowledge it, log it, confirm severity. You track issues about the AI team's performance.`;

  protected getBotToken(): string | undefined {
    return process.env.PATRICIA_BOT_TOKEN;
  }

  protected getAppToken(): string | undefined {
    return process.env.PATRICIA_APP_TOKEN;
  }

  // Override handleMessage to check for feedback commands first
  async handleMessage(message: IncomingMessage): Promise<void> {
    // Check for feedback command before normal processing
    const feedbackResult = await this.handleFeedbackIfPresent(message);
    if (feedbackResult) {
      // Feedback was logged - let the normal response generation handle the acknowledgment
      // The context about logged feedback is passed to the LLM
      console.log(`Patricia: Detected feedback command: ${feedbackResult}`);
    }

    // Continue with normal message handling
    await super.handleMessage(message);
  }

  // Check if message is a feedback command and handle it
  async handleFeedbackIfPresent(message: IncomingMessage): Promise<string | null> {
    const text = message.text.toLowerCase();

    // Check for feedback patterns
    const feedbackPatterns = [
      /patricia,?\s*(log\s+)?feedback[:\s]+(.+)/i,
      /patricia,?\s*bug[:\s]+(.+)/i,
      /patricia,?\s*great\s+catch[:\s]+(.+)/i,
      /patricia,?\s*suggestion[:\s]+(.+)/i,
    ];

    let feedbackType:
      | 'bug'
      | 'wrong_answer'
      | 'great_catch'
      | 'suggestion'
      | 'annoying'
      | 'missing_info' = 'suggestion';
    let feedbackText = '';

    for (const pattern of feedbackPatterns) {
      const match = message.text.match(pattern);
      if (match) {
        feedbackText = match[match.length - 1].trim();

        if (text.includes('bug')) feedbackType = 'bug';
        else if (text.includes('great catch')) feedbackType = 'great_catch';
        else if (text.includes('wrong')) feedbackType = 'wrong_answer';
        else if (text.includes('annoying')) feedbackType = 'annoying';
        else if (text.includes('missing')) feedbackType = 'missing_info';

        break;
      }
    }

    if (!feedbackText) return null;

    // Extract agent name from feedback
    const agentNames = ['maya', 'david', 'rosa', 'james', 'patricia', 'jodie', 'marcus'];
    let agent = 'unknown';
    for (const name of agentNames) {
      if (feedbackText.toLowerCase().includes(name)) {
        agent = name.charAt(0).toUpperCase() + name.slice(1);
        break;
      }
    }

    // Log the feedback
    const result = await logFeedback({
      agent,
      feedback_type: feedbackType,
      what_happened: feedbackText,
      severity: 'medium',
      slack_ts: message.messageTs,
    });

    if (result) {
      console.log(`Patricia: Logged feedback - ${feedbackType} for ${agent}`);
      return `logged_feedback:${feedbackType}:${agent}`;
    }

    return null;
  }

  // Get weekly summary for Monday check-ins
  async getWeeklySummary(): Promise<string> {
    const summary = await getFeedbackSummary(7);

    if (summary.total === 0) {
      return "No feedback logged this week - either things are going great or we're not tracking issues!";
    }

    const typeList = Object.entries(summary.byType)
      .map(([type, count]) => `${count} ${type.replace('_', ' ')}${count > 1 ? 's' : ''}`)
      .join(', ');

    const agentList = Object.entries(summary.byAgent)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([agent, count]) => `${agent}: ${count}`)
      .join(', ');

    let response = `Last week's feedback: ${typeList}.\n`;
    if (agentList) response += `Most mentions: ${agentList}.\n`;
    if (summary.unresolved > 0)
      response += `${summary.unresolved} item${summary.unresolved > 1 ? 's' : ''} still unresolved.`;

    return response;
  }
}

export const patricia = new PatriciaAgent();
