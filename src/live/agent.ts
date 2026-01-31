// Live conversational agent base class

import { App, LogLevel } from '@slack/bolt';
import { getAnthropic } from '../integrations/claude.js';
import { logAgentMemory } from '../integrations/supabase.js';
import type {
  LiveAgentName,
  LiveAgentConfig,
  IncomingMessage,
  ThreadContext,
  ThreadMessage,
  AgentResponse,
  NAME_TO_AGENT,
  AGENT_EXPERTISE,
} from './types.js';

export abstract class LiveAgent {
  abstract name: LiveAgentName;
  abstract displayName: string;
  abstract systemPrompt: string;

  protected app: App | null = null;
  protected slackUserId: string | null = null;
  protected channelId: string;

  // Track active threads this agent is participating in
  protected activeThreads: Set<string> = new Set();

  // Track recently processed messages to avoid duplicates
  protected processedMessages: Set<string> = new Set();

  constructor() {
    this.channelId = process.env.SLACK_CHANNEL_ID || '';
  }

  // Initialize the Slack app for this agent
  async connect(): Promise<void> {
    const botToken = this.getBotToken();
    const appToken = this.getAppToken();

    if (!botToken || !appToken) {
      throw new Error(`Missing tokens for ${this.displayName}. Check .env file.`);
    }

    this.app = new App({
      token: botToken,
      appToken: appToken,
      socketMode: true,
      logLevel: LogLevel.WARN,
    });

    // Get this bot's user ID
    const authResult = await this.app.client.auth.test();
    this.slackUserId = authResult.user_id as string;
    console.log(`${this.displayName}: Connected as <@${this.slackUserId}>`);

    // Set up event handlers
    this.setupEventHandlers();

    // Start the app
    await this.app.start();
    console.log(`${this.displayName}: Listening for messages...`);
  }

  // Get bot token from env
  protected abstract getBotToken(): string | undefined;
  protected abstract getAppToken(): string | undefined;

  // Set up Slack event handlers
  private setupEventHandlers(): void {
    if (!this.app) return;

    // Handle @mentions
    this.app.event('app_mention', async ({ event, say }) => {
      const msg = event as any;
      const messageId = msg.ts;

      // Dedupe: skip if we already processed this message
      if (this.processedMessages.has(messageId)) return;
      this.processedMessages.add(messageId);

      // Clean up old messages after 5 minutes
      setTimeout(() => this.processedMessages.delete(messageId), 5 * 60 * 1000);

      console.log(`${this.displayName}: Mentioned in message`);

      const message = this.parseIncomingMessage(event);
      if (message) {
        await this.handleMessage(message);
      }
    });

    // Handle messages in channels (for thread replies, agent cross-talk, and proactive responses)
    this.app.event('message', async ({ event }) => {
      const msg = event as any;
      const messageId = msg.ts;

      // Dedupe: skip if we already processed this message (via app_mention or earlier)
      if (this.processedMessages.has(messageId)) return;

      // Ignore our OWN messages (prevent self-loops)
      if (msg.bot_id && msg.user === this.slackUserId) return;

      // Check if we're mentioned in this message (for agent cross-talk)
      const text = (msg.text || '').toLowerCase();
      const isMentioned = (msg.text || '').includes(`<@${this.slackUserId}>`);

      // For bot messages (other agents), only respond if directly @mentioned
      const isFromBot = msg.bot_id || msg.subtype === 'bot_message';
      if (isFromBot && !isMentioned) return;

      // Check if this is in a thread we're active in
      const threadTs = msg.thread_ts;
      const isInActiveThread = threadTs && this.activeThreads.has(threadTs) && !isFromBot;

      // Check if this is a general channel message (not in a thread) that we should respond to
      const isGeneralMessage = !threadTs && !isFromBot && msg.channel === this.channelId;
      let shouldProactivelyRespond = false;

      if (isGeneralMessage) {
        // Patricia responds to general check-ins
        if (this.name === 'patricia') {
          const checkInPhrases = ['what\'s happening', 'status', 'update', 'what\'s up', 'checking in', 'standup', 'quiet in here', 'anyone there', 'y\'all'];
          shouldProactivelyRespond = checkInPhrases.some(phrase => text.includes(phrase));
        }

        // Other agents respond if message matches their expertise
        if (!shouldProactivelyRespond) {
          const expertiseKeywords: Record<string, string[]> = {
            maya: ['opportunity', 'sam.gov', 'rfp', 'rfi', 'solicitation', 'found', 'new opp'],
            david: ['research', 'risk', 'incumbent', 'agency', 'red flag', 'due diligence', 'analyze'],
            rosa: ['partner', 'team', 'teaming', 'subcontractor', 'relationship', 'intro'],
            james: ['strategy', 'go/no-go', 'decision', 'win', 'capture', 'bid', 'pursue'],
            patricia: [], // Patricia handled above
          };
          const myKeywords = expertiseKeywords[this.name] || [];
          shouldProactivelyRespond = myKeywords.some(kw => text.includes(kw));
        }
      }

      const shouldHandle = isMentioned || isInActiveThread || shouldProactivelyRespond;

      if (shouldHandle) {
        // Mark as processed to avoid duplicates
        this.processedMessages.add(messageId);
        setTimeout(() => this.processedMessages.delete(messageId), 5 * 60 * 1000);

        const reason = isMentioned ? 'Mentioned by agent' :
                       isInActiveThread ? 'Message in active thread' :
                       'Proactive response to channel message';
        console.log(`${this.displayName}: ${reason}`);

        const message = this.parseIncomingMessage(event);
        if (message) {
          await this.handleMessage(message);
        }
      }
    });
  }

  // Parse raw Slack event into our message format
  private parseIncomingMessage(event: any): IncomingMessage | null {
    const text = event.text || '';
    const userId = event.user;
    const channelId = event.channel;
    const threadTs = event.thread_ts || event.ts;
    const messageTs = event.ts;

    // Find mentioned agents
    const mentionedAgents = this.extractMentionedAgents(text);
    const isDirectMention = mentionedAgents.includes(this.name);
    const isInActiveThread = this.activeThreads.has(threadTs);

    return {
      text: this.cleanMessageText(text),
      userId,
      channelId,
      threadTs,
      messageTs,
      mentionedAgents,
      isDirectMention,
      isInActiveThread,
    };
  }

  // Extract which agents are mentioned in the text
  private extractMentionedAgents(text: string): LiveAgentName[] {
    const mentioned: LiveAgentName[] = [];
    const lowerText = text.toLowerCase();

    // Check for @mentions by Slack user ID (would need to map these)
    // For now, check for name mentions
    const agents: LiveAgentName[] = ['maya', 'david', 'rosa', 'james', 'patricia'];

    for (const agent of agents) {
      if (lowerText.includes(`@${agent}`) || lowerText.includes(`<@`) && this.name === agent) {
        mentioned.push(agent);
      }
    }

    return mentioned;
  }

  // Clean up Slack formatting from message text
  private cleanMessageText(text: string): string {
    // Remove user mentions formatting
    return text
      .replace(/<@[A-Z0-9]+>/g, (match) => {
        // Keep mentions but clean up format
        return match;
      })
      .trim();
  }

  // Main message handler
  async handleMessage(message: IncomingMessage): Promise<void> {
    // Should we respond?
    const response = await this.generateResponse(message);

    if (response.shouldRespond) {
      // Add to active threads
      if (message.threadTs) {
        this.activeThreads.add(message.threadTs);
      }

      // Wait for natural delay
      console.log(`${this.displayName}: Waiting ${response.delayMs}ms before responding...`);
      await this.sleep(response.delayMs);

      // Post response
      await this.postMessage(response.text, message.threadTs || message.messageTs);

      // Log to agent_memory for auditing
      await logAgentMemory({
        agent: this.name,
        message_ts: message.messageTs,
        thread_ts: message.threadTs,
        response_text: response.text,
        sources: response.sources,
        confidence_level: response.confidenceLevel,
      });

      // Log sources to console for visibility
      if (response.sources.length > 0) {
        console.log(`${this.displayName}: Sources: ${response.sources.join(', ')} (${response.confidenceLevel} confidence)`);
      }
    }
  }

  // Generate a response using Claude
  async generateResponse(message: IncomingMessage): Promise<AgentResponse> {
    const client = getAnthropic();

    // Load thread context if in a thread
    let threadContext = '';
    if (message.threadTs) {
      const context = await this.loadThreadContext(message.threadTs, message.channelId);
      if (context.messages.length > 0) {
        threadContext = '\n\nTHREAD CONTEXT (previous messages):\n' +
          context.messages.map(m => `${m.author}: ${m.text}`).join('\n');
      }
    }

    const prompt = `You are ${this.displayName}, responding in a Slack conversation.

${this.systemPrompt}

CURRENT MESSAGE:
From: User (likely Lapedra, the CEO)
Message: "${message.text}"
${threadContext}

RESPOND LIKE A REAL HUMAN:
- Vary your sentence structure - don't always start the same way
- Sometimes be brief (1 sentence), sometimes elaborate (3-4 sentences)
- Use natural filler occasionally ("hmm", "yeah", "so", "actually")
- Don't always use your catchphrases - real people vary
- Sometimes just react ("interesting" or "good question") before answering
- Typos are okay occasionally (dont vs don't, gonna vs going to)
- Don't be overly formal or polished
- If you don't have much to add, just don't respond

SOURCE EVERYTHING (critical):
- Always cite where facts come from: "According to SAM.gov...", "FPDS shows...", "USAspending has them at..."
- If you don't have data, SAY SO: "I don't have data on this", "I'd want to verify that", "Can't confirm without checking"
- Never make up facts, numbers, or sources
- Distinguish what you know vs. what you're inferring

CONFIDENCE LEVELS - indicate how sure you are:
- HIGH confidence: "The solicitation says..." / "FPDS shows..." (official source)
- MEDIUM confidence: "Based on similar contracts..." / "Pattern suggests..." (inference from data)
- LOW confidence: "My gut says..." / "This is a guess but..." / "Take this with a grain of salt..."

FACT-CHECK EACH OTHER:
- If another agent said something you're unsure about, ask: "Where'd you see that?" or "Can we verify that?"
- If questioned, be honest: "Good catch, I was inferring" or "That's in SAM, I can pull the link"

ADMIT UNKNOWNS - use these naturally:
- "I don't have data on this"
- "I'd want to verify before we commit"
- "This is a guess based on patterns"
- "Can someone check me on this?"
- "Not sure, would need to dig into FPDS"
- "I couldn't find solid data on this"

WHEN TO RESPOND:
- You were directly @mentioned → YES, respond
- This is clearly your area AND you have something NEW to add → respond
- Someone else already said what you'd say → DON'T pile on
- It's not your area → stay quiet

TAGGING OTHER AGENTS:
- If a question is better suited for someone else, tag them: "That's more @David's area" or "@Rosa might know"
- If you need input from another agent, ask: "@David, any red flags here?"
- Don't tag someone just to agree - only if you need their specific expertise
- Agent Slack IDs: Maya=<@U0AC3RA4JVB>, David=<@U0AC0SVD3MH>, Rosa=<@U0ACASZ36BW>, James=<@U0AC582GXBQ>, Patricia=<@U0AC79NTDAN>

WHEN TO STAY QUIET (important!):
- Another agent already covered it
- You'd just be agreeing without adding value
- It's outside your expertise
- The conversation doesn't need your input

Respond in JSON:
{
  "shouldRespond": true/false,
  "confidence": 0.0-1.0,
  "response": "Your response text (or empty if not responding)",
  "sources": ["list of sources cited, if any, e.g. 'SAM.gov', 'FPDS', 'inference'"],
  "confidenceLevel": "HIGH/MEDIUM/LOW"
}`;

    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      });

      const textBlock = response.content.find(b => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        return { text: '', shouldRespond: false, delayMs: 0, confidence: 0, sources: [], confidenceLevel: 'LOW' as const };
      }

      // Parse JSON response
      let jsonText = textBlock.text;
      const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonText = jsonMatch[0];
      }

      const parsed = JSON.parse(jsonText);

      // Calculate delay (2-8 seconds, randomized) - fast enough to feel responsive
      const baseDelay = 2000 + Math.random() * 6000;
      const delay = message.isDirectMention ? baseDelay * 0.5 : baseDelay; // Faster for direct mentions

      // Normalize confidence level
      const rawLevel = (parsed.confidenceLevel || 'LOW').toUpperCase();
      const confidenceLevel = ['HIGH', 'MEDIUM', 'LOW'].includes(rawLevel) ? rawLevel as 'HIGH' | 'MEDIUM' | 'LOW' : 'LOW';

      return {
        text: parsed.response || '',
        shouldRespond: parsed.shouldRespond && parsed.response,
        delayMs: Math.floor(delay),
        confidence: parsed.confidence || 0.5,
        sources: parsed.sources || [],
        confidenceLevel,
      };
    } catch (error) {
      console.error(`${this.displayName}: Error generating response:`, error);
      return { text: '', shouldRespond: false, delayMs: 0, confidence: 0, sources: [], confidenceLevel: 'LOW' as const };
    }
  }

  // Load context from a thread
  async loadThreadContext(threadTs: string, channelId: string): Promise<ThreadContext> {
    if (!this.app) {
      return { threadTs, messages: [], participants: [] };
    }

    try {
      const result = await this.app.client.conversations.replies({
        channel: channelId,
        ts: threadTs,
        limit: 20,
      });

      const messages: ThreadMessage[] = [];
      const participants: Set<string> = new Set();

      for (const msg of result.messages || []) {
        // Determine author
        let author = 'unknown';
        if (msg.bot_id) {
          // Map bot to agent name based on username or other identifier
          author = (msg as any).username?.toLowerCase() || 'bot';
        } else if (msg.user) {
          author = 'lapedra'; // Assume human is Lapedra
          participants.add(msg.user);
        }

        messages.push({
          author,
          text: msg.text || '',
          ts: msg.ts || '',
        });
      }

      return {
        threadTs,
        messages,
        participants: Array.from(participants),
      };
    } catch (error) {
      console.error(`${this.displayName}: Error loading thread:`, error);
      return { threadTs, messages: [], participants: [] };
    }
  }

  // Post a message
  async postMessage(text: string, threadTs?: string): Promise<void> {
    if (!this.app) return;

    try {
      await this.app.client.chat.postMessage({
        channel: this.channelId,
        text,
        thread_ts: threadTs,
        unfurl_links: false,
        unfurl_media: false,
      });
      console.log(`${this.displayName}: Posted response`);
    } catch (error) {
      console.error(`${this.displayName}: Error posting message:`, error);
    }
  }

  // Add reaction to a message
  async addReaction(emoji: string, messageTs: string): Promise<void> {
    if (!this.app) return;

    try {
      await this.app.client.reactions.add({
        channel: this.channelId,
        timestamp: messageTs,
        name: emoji,
      });
    } catch (error) {
      // Ignore reaction errors
    }
  }

  // Disconnect
  async disconnect(): Promise<void> {
    if (this.app) {
      await this.app.stop();
      console.log(`${this.displayName}: Disconnected`);
    }
  }

  // Sleep helper
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
