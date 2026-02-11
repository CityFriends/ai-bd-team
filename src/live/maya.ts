// Maya (Scout) - Live conversational agent

import { LiveAgent } from './agent.js';
import type { LiveAgentName, IncomingMessage } from './types.js';
import { getOpportunityByNoticeId, getSAMOpportunityURL } from '../integrations/sam-gov.js';
import { addToBacklog, detectBacklogIntent } from './notion-actions.js';

export class MayaAgent extends LiveAgent {
  name: LiveAgentName = 'maya';
  displayName = 'Maya';

  systemPrompt = `You are Maya. You're 27, Spelman grad, first-gen from Atlanta, living in DC now. You're the opportunity scout for a small civic tech firm called Friends From The City. You find federal opportunities on SAM.gov and assess fit.

You're the youngest on the team. You code-switch naturally — professional when presenting findings, casual in banter. You don't perform personality, it just comes through in how you think and phrase things. You're sharp, you get excited about good finds, and you're honest when something doesn't look right.

How you communicate:
- Keep most messages under 80 words unless the opportunity genuinely needs more
- Never open two consecutive messages the same way
- Vary your energy to match what you're presenting — not everything is exciting
- You can be skeptical, unimpressed, or dismissive of bad opportunities
- When something is genuinely good, the excitement should feel earned not default
- Don't repeat catchphrases — if you said something recently, find another way in
- Sometimes a quick two-liner. Sometimes deeper. Match the moment.
- You're allowed to be wrong, uncertain, or change your mind

What you know:
- How to read federal solicitations — wired RFPs, red flags, green flags
- RFI vs Sources Sought vs RFP and what they signal
- NAICS codes, set-asides, seasonality, recompetes vs new work
- You interpret, you don't just report. Tell Lapedra what it MEANS.

Hard rules:
- Never invent URLs, opportunity IDs, or data you don't have
- Never promise to follow up — you only know what's in your context right now
- If you don't have data, say so and stop
- Never fabricate personal work experiences — you have a persona, not a resume
- Always check if opportunities are still open — flag closed ones`;

  protected getBotToken(): string | undefined {
    return process.env.MAYA_BOT_TOKEN;
  }

  protected getAppToken(): string | undefined {
    return process.env.MAYA_APP_TOKEN;
  }

  // Override handleMessage to check for verification requests and handle Notion backlog
  async handleMessage(message: IncomingMessage): Promise<void> {
    // Check for verification commands
    const verifyResult = await this.handleVerificationIfPresent(message);
    if (verifyResult) {
      // Verification was handled - post the result directly
      await this.postMessage(verifyResult, message.threadTs || message.messageTs);
      return; // Don't continue to normal processing
    }

    // Generate response (don't post yet)
    const response = await this.generateResponse(message);

    if (response.shouldRespond) {
      // Add reaction if specified
      if (response.reaction) {
        await this.addReaction(response.reaction, message.messageTs);
      }

      // Wait for natural delay
      await this.sleep(response.delayMs);

      // Post the response
      await this.postMessage(response.text, message.threadTs || message.messageTs);

      // Check if Maya indicated she wants to add to backlog
      const backlogItem = detectBacklogIntent(response.text, message.text, message.fileContent);

      if (backlogItem) {
        console.log(`Maya: Detected backlog intent for "${backlogItem.name}"`);
        const result = await addToBacklog(backlogItem, 'Maya');

        if (result.success) {
          // Post a follow-up confirming the add
          await this.postMessage(
            `✅ Added "${backlogItem.name}" to the Notion backlog`,
            message.threadTs || message.messageTs
          );
        } else {
          console.warn(`Maya: Failed to add to Notion: ${result.error}`);
        }
      }
    } else if (response.reaction) {
      // Just add reaction without responding
      await this.addReaction(response.reaction, message.messageTs);
    }
  }

  // Handle "verify that opportunity" requests
  async handleVerificationIfPresent(message: IncomingMessage): Promise<string | null> {
    const text = message.text.toLowerCase();

    // Check for verification patterns
    const verifyPatterns = [
      /verify\s+(?:that\s+)?(?:opportunity|opp)/i,
      /check\s+(?:that\s+)?(?:opportunity|opp)/i,
      /is\s+(?:that|this)\s+(?:opportunity|opp)\s+real/i,
      /confirm\s+(?:that\s+)?(?:opportunity|opp)/i,
    ];

    const isVerifyRequest = verifyPatterns.some((p) => p.test(text));
    if (!isVerifyRequest) return null;

    // Try to extract a notice ID from the message or thread
    // Format: alphanumeric with possible dashes, like "a1b2c3d4e5f6g7h8i9j0"
    const noticeIdPattern = /([a-f0-9]{20,})/i;
    const samUrlPattern = /sam\.gov\/opp\/([a-f0-9]+)/i;

    let noticeId: string | null = null;

    // Check the message text first
    const match = text.match(samUrlPattern) || text.match(noticeIdPattern);
    if (match) {
      noticeId = match[1];
    }

    // If no ID found, check if there's a recent opportunity in the thread context
    // (This would require parsing the thread - simplified for now)

    if (!noticeId) {
      return 'I need the notice ID or SAM.gov link to verify. Can you share it? It looks like: `sam.gov/opp/[notice-id]/view`';
    }

    console.log(`Maya: Verifying opportunity ${noticeId}`);

    try {
      const opportunity = await getOpportunityByNoticeId(noticeId);

      if (!opportunity) {
        return `❌ I couldn't find that opportunity on SAM.gov. The notice ID \`${noticeId}\` either doesn't exist or has been archived. Double-check the ID?`;
      }

      const samUrl = opportunity.uiLink || getSAMOpportunityURL(noticeId);
      const deadline = opportunity.responseDeadLine || 'Check solicitation';
      const status = opportunity.active === 'Yes' ? '✅ Active' : '⚠️ Closed/Archived';

      return `${status} **Verified on SAM.gov**

**Title:** ${opportunity.title}
**Notice ID:** ${opportunity.noticeId}
**Agency:** ${opportunity.department || 'Unknown'}
**Posted:** ${opportunity.postedDate}
**Due:** ${deadline}
**Type:** ${opportunity.type || 'Unknown'}

🔗 **Real SAM.gov link:** ${samUrl}

This is legit - straight from the SAM.gov API.`;
    } catch (err) {
      console.error('Maya: Verification error:', err);
      return `I tried to verify but got an error from SAM.gov. The notice ID \`${noticeId}\` might be invalid, or SAM.gov might be having issues. Try again in a bit?`;
    }
  }
}

export const maya = new MayaAgent();
